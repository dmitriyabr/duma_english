import { prisma } from "@/lib/db";

export type GseReliability = "high" | "medium" | "low";

export type MasteryEvidence = {
  nodeId: string;
  confidence: number; // 0..1
  impact: number; // 0..1
  reliability: GseReliability;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function reliabilityFactor(reliability: GseReliability) {
  if (reliability === "high") return 1;
  if (reliability === "medium") return 0.7;
  return 0.45;
}

export function computeNextMasteryScore(current: number, evidence: MasteryEvidence) {
  const confidence = clamp(evidence.confidence * 100) / 100;
  const impact = clamp(evidence.impact * 100) / 100;
  const factor = reliabilityFactor(evidence.reliability);
  const delta = 18 * confidence * impact * factor;
  return Number(clamp(current + delta).toFixed(2));
}

export async function applyEvidenceToStudentMastery(params: {
  studentId: string;
  evidences: MasteryEvidence[];
  calculationVersion: string;
}) {
  for (const evidence of params.evidences) {
    const existing = await prisma.studentGseMastery.findUnique({
      where: {
        studentId_nodeId: {
          studentId: params.studentId,
          nodeId: evidence.nodeId,
        },
      },
    });

    const current = existing?.masteryScore ?? 25;
    const next = computeNextMasteryScore(current, evidence);
    const reliability: GseReliability =
      existing?.reliability === "high" || evidence.reliability === "high"
        ? "high"
        : existing?.reliability === "medium" || evidence.reliability === "medium"
        ? "medium"
        : "low";

    await prisma.studentGseMastery.upsert({
      where: {
        studentId_nodeId: {
          studentId: params.studentId,
          nodeId: evidence.nodeId,
        },
      },
      update: {
        masteryScore: next,
        reliability,
        evidenceCount: { increment: 1 },
        lastEvidenceAt: new Date(),
        calculationVersion: params.calculationVersion,
      },
      create: {
        studentId: params.studentId,
        nodeId: evidence.nodeId,
        masteryScore: next,
        reliability,
        evidenceCount: 1,
        lastEvidenceAt: new Date(),
        calculationVersion: params.calculationVersion,
      },
    });
  }
}

