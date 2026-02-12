import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";
import { ensureLearnerProfile } from "@/lib/adaptive";
import { getStudentProgress } from "@/lib/progress";
import { computeStageBundleReadiness } from "@/lib/gse/bundles";
import { mapStageToGseRange } from "@/lib/gse/utils";

async function ensureTeacherCanAccessStudent(
  teacherId: string,
  studentId: string
) {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    include: {
      class: { select: { id: true, name: true, teacherId: true } },
    },
  });
  if (!student || student.class.teacherId !== teacherId) return null;
  return student;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { studentId } = await params;
  const student = await ensureTeacherCanAccessStudent(
    teacher.teacherId,
    studentId
  );
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  await ensureLearnerProfile(studentId);
  const progress = await getStudentProgress(studentId);

  const [recentAttempts, fullMasteryRows, attemptsWithOutcomes] = await Promise.all([
    prisma.attempt.findMany({
      where: { studentId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
        scoresJson: true,
        task: {
          select: { type: true, prompt: true },
        },
      },
    }),
    prisma.studentGseMastery.findMany({
      where: { studentId },
      include: {
        node: {
          select: {
            nodeId: true,
            descriptor: true,
            type: true,
            skill: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 400,
    }),
    prisma.attempt.findMany({
      where: { studentId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, createdAt: true, nodeOutcomesJson: true },
    }),
  ]);

  const fullMastery = fullMasteryRows.map((m) => ({
    nodeId: m.nodeId,
    descriptor: m.node.descriptor,
    type: m.node.type,
    skill: m.node.skill,
    masteryScore: m.masteryScore,
    decayedMastery: m.decayedMastery ?? m.masteryMean ?? m.masteryScore,
    evidenceCount: m.evidenceCount,
    directEvidenceCount: m.directEvidenceCount,
    activationState: m.activationState,
    lastEvidenceAt: m.lastEvidenceAt,
    updatedAt: m.updatedAt,
    halfLifeDays: m.halfLifeDays,
    masterySigma: m.masterySigma,
  }));

  type NodeOutcome = {
    nodeId: string;
    deltaMastery: number;
    decayImpact: number;
    previousMean?: number;
    nextMean?: number;
    reliability?: string;
    evidenceCount?: number;
    streakMultiplier?: number;
  };
  const recentNodeOutcomes: Array<{
    descriptor: string;
    nodeId: string;
    stage: string;
    deltaMastery: number;
    decayImpact: number;
    previousMean?: number;
    nextMean?: number;
    attemptCreatedAt: string;
    streakMultiplier?: number;
  }> = [];
  const nodeIdsFromOutcomes = new Set<string>();
  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    for (const o of outcomes) nodeIdsFromOutcomes.add(o.nodeId);
  }
  function gseBandFromCenter(value: number | null | undefined): string {
    if (typeof value !== "number") return "A0";
    if (value <= 29) return "A1";
    if (value <= 42) return "A2";
    if (value <= 58) return "B1";
    if (value <= 75) return "B2";
    if (value <= 84) return "C1";
    return "C2";
  }

  const nodeIdToInfo =
    nodeIdsFromOutcomes.size > 0
      ? await prisma.gseNode
          .findMany({
            where: { nodeId: { in: Array.from(nodeIdsFromOutcomes) } },
            select: { nodeId: true, descriptor: true, gseCenter: true },
          })
          .then((rows) =>
            new Map(rows.map((r) => [r.nodeId, { descriptor: r.descriptor, stage: gseBandFromCenter(r.gseCenter) }]))
          )
      : new Map<string, { descriptor: string; stage: string }>();

  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    const attemptDate = a.createdAt.toISOString();
    for (const o of outcomes) {
      const info = nodeIdToInfo.get(o.nodeId);
      recentNodeOutcomes.push({
        descriptor: info?.descriptor ?? o.nodeId,
        nodeId: o.nodeId,
        stage: info?.stage ?? "A0",
        deltaMastery: o.deltaMastery,
        decayImpact: o.decayImpact,
        previousMean: o.previousMean,
        nextMean: o.nextMean,
        attemptCreatedAt: attemptDate,
        ...(typeof o.streakMultiplier === "number" && { streakMultiplier: o.streakMultiplier }),
      });
    }
  }

  const STAGES = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
  type CEFRStageType = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  const placementStage = (progress as { placementStage?: string }).placementStage;
  const ds = (progress as { domainStages?: { vocab: { stage: string }; grammar: { stage: string }; communication: { stage: string } } }).domainStages;
  const domainPlacementStages = ds ? {
    vocab: ds.vocab.stage as CEFRStageType,
    grammar: ds.grammar.stage as CEFRStageType,
    lo: ds.communication.stage as CEFRStageType,
  } : undefined;

  const [catalogNodesByBand, bundleReadiness] = await Promise.all([
    Promise.all(
      STAGES.map(async (stage) => {
        const range = mapStageToGseRange(stage);
        const count = await prisma.gseNode.count({
          where: { gseCenter: { gte: range.min, lte: range.max } },
        });
        return [stage, count] as const;
      })
    ).then((pairs) => Object.fromEntries(pairs)),
    computeStageBundleReadiness(studentId, placementStage as CEFRStageType | undefined, domainPlacementStages),
  ]);

  const perStageCredited: Record<string, number> = {};
  const perStageBundleTotal: Record<string, number> = {};
  for (const row of bundleReadiness.stageRows) {
    perStageCredited[row.stage] = row.bundleRows.reduce((sum, b) => sum + b.coveredCount, 0);
    perStageBundleTotal[row.stage] = row.bundleRows.reduce((sum, b) => sum + b.totalRequired, 0);
  }

  // Per-domain promotion path: each domain targets domainStage + 1
  const STAGE_SEQ = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
  const domainStageMap: Record<string, string> = {
    vocab: ds?.vocab.stage ?? "A1",
    grammar: ds?.grammar.stage ?? "A1",
    lo: ds?.communication.stage ?? "A1",
  };

  const domainBundleBlockers: Record<string, Array<{ nodeId: string; descriptor: string; value: number }>> = {};
  const domainPromotionPath: Record<string, {
    currentStage: string;
    targetStage: string;
    title: string;
    coveredCount: number;
    totalRequired: number;
    ready: boolean;
    blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
    achieved: Array<{ nodeId: string; descriptor: string; value: number }>;
  }> = {};

  for (const domain of ["vocab", "grammar", "lo"]) {
    const current = domainStageMap[domain];
    const idx = STAGE_SEQ.indexOf(current as typeof STAGE_SEQ[number]);
    if (idx < 0 || idx >= STAGE_SEQ.length - 1) continue;
    const target = STAGE_SEQ[idx + 1];
    const row = bundleReadiness.rows.find((r) => r.stage === target && r.domain === domain);
    if (!row) continue;
    const blockers = row.blockers.sort((a, b) => a.value - b.value).slice(0, 8);
    domainBundleBlockers[domain] = blockers;
    domainPromotionPath[domain] = {
      currentStage: current,
      targetStage: target,
      title: row.title,
      coveredCount: row.coveredCount,
      totalRequired: row.totalRequired,
      ready: row.ready,
      blockers,
      achieved: row.achieved.slice(0, 8),
    };
  }

  return NextResponse.json({
    student: {
      id: student.id,
      displayName: student.displayName,
      createdAt: student.createdAt,
      classId: student.classId,
      className: student.class.name,
    },
    progress,
    catalogNodesByBand,
    perStageCredited,
    perStageBundleTotal,
    recentAttempts: recentAttempts.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
      scores: a.scoresJson,
      taskType: a.task.type,
      promptPreview: a.task.prompt?.slice(0, 120),
    })),
    fullMastery,
    recentNodeOutcomes: recentNodeOutcomes.slice(0, 80),
    domainBundleBlockers,
    domainPromotionPath,
  });
}
