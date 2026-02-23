import { prisma } from "@/lib/db";
import { mapStageToGseRange } from "@/lib/gse/utils";
import type { CoverageDebtView } from "@/lib/contracts/lessonRuntime";

const CANDIDATE_NODE_CAP = 180;
const MIN_EVIDENCE_FOR_STABLE = 3;
const MASTERY_FLOOR = 65;

function stageOrDefault(stage: string | null | undefined) {
  return stage && stage.trim().length > 0 ? stage : "A1";
}

export async function computeCoverageDebt(studentId: string, stageHint?: string): Promise<CoverageDebtView> {
  const profile = await prisma.learnerProfile.findUnique({
    where: { studentId },
    select: { stage: true, ageBand: true },
  });

  const stage = stageOrDefault(stageHint || profile?.stage);
  const range = mapStageToGseRange(stage);
  const audience = profile?.ageBand ? "YL" : "AL";

  const [candidateNodes, masteryRows] = await Promise.all([
    prisma.gseNode.findMany({
      where: {
        gseCenter: { gte: range.min - 3, lte: range.max + 3 },
        audience: { in: [audience, "YL", "AL", "AE"] },
      },
      orderBy: [{ gseCenter: "asc" }, { updatedAt: "desc" }],
      take: CANDIDATE_NODE_CAP,
      select: {
        nodeId: true,
        descriptor: true,
      },
    }),
    prisma.studentGseMastery.findMany({
      where: { studentId },
      select: {
        nodeId: true,
        masteryScore: true,
        masteryMean: true,
        decayedMastery: true,
        evidenceCount: true,
      },
    }),
  ]);

  const masteryByNode = new Map(
    masteryRows.map((row) => [
      row.nodeId,
      {
        evidenceCount: row.evidenceCount,
        mastery: row.decayedMastery ?? row.masteryMean ?? row.masteryScore,
      },
    ]),
  );

  let unseen = 0;
  let underTested = 0;
  const severe: Array<{ nodeId: string; descriptor: string; score: number }> = [];

  for (const node of candidateNodes) {
    const mastery = masteryByNode.get(node.nodeId);
    if (!mastery) {
      unseen += 1;
      severe.push({
        nodeId: node.nodeId,
        descriptor: node.descriptor,
        score: 0,
      });
      continue;
    }

    const insufficientEvidence = mastery.evidenceCount < MIN_EVIDENCE_FOR_STABLE;
    const lowMastery = mastery.mastery < MASTERY_FLOOR;
    if (insufficientEvidence || lowMastery) {
      underTested += 1;
      const severityScore = Math.max(1, Math.round((100 - mastery.mastery) + (MIN_EVIDENCE_FOR_STABLE - mastery.evidenceCount) * 12));
      severe.push({
        nodeId: node.nodeId,
        descriptor: node.descriptor,
        score: severityScore,
      });
    }
  }

  severe.sort((left, right) => right.score - left.score);

  return {
    total: unseen + underTested,
    unseen,
    underTested,
    severeNodeIds: severe.slice(0, 8).map((row) => row.nodeId),
    severeDescriptors: severe.slice(0, 8).map((row) => row.descriptor),
  };
}
