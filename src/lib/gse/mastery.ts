import { prisma } from "@/lib/db";

export type GseReliability = "high" | "medium" | "low";

export type MasteryEvidence = {
  nodeId: string;
  confidence: number; // 0..1
  impact: number; // 0..1
  reliability: GseReliability;
};

export type NodeMasteryOutcome = {
  nodeId: string;
  previousMean: number;
  nextMean: number;
  previousDecayed: number;
  nextDecayed: number;
  deltaMastery: number;
  decayImpact: number;
  reliability: GseReliability;
  evidenceCount: number;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function reliabilityFactor(reliability: GseReliability) {
  if (reliability === "high") return 1;
  if (reliability === "medium") return 0.7;
  return 0.45;
}

function defaultHalfLifeDays(nodeType: string | null, skill: string | null) {
  if (nodeType === "GSE_VOCAB" || skill === "vocabulary") return 14;
  if (nodeType === "GSE_GRAMMAR" || skill === "grammar") return 21;
  return 10;
}

function daysBetween(from: Date | null | undefined, to: Date) {
  if (!from) return 0;
  const ms = Math.max(0, to.getTime() - from.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function effectiveHalfLifeDays(base: number, evidenceCount: number, reliability: GseReliability) {
  const repetitionBoost = 1 + Math.log2(Math.max(1, evidenceCount + 1)) * 0.35;
  const reliabilityBoost = reliability === "high" ? 1.2 : reliability === "medium" ? 1 : 0.85;
  return Math.max(3, base * repetitionBoost * reliabilityBoost);
}

export function computeDecayedMastery(params: {
  masteryMean: number;
  lastEvidenceAt: Date | null;
  now: Date;
  halfLifeDays: number;
  evidenceCount: number;
  reliability: GseReliability;
}) {
  const deltaDays = daysBetween(params.lastEvidenceAt, params.now);
  const halfLife = effectiveHalfLifeDays(
    params.halfLifeDays,
    params.evidenceCount,
    params.reliability
  );
  const decay = Math.exp((-Math.log(2) * deltaDays) / halfLife);
  return Number(clamp(params.masteryMean * decay).toFixed(2));
}

export function computeNextMasteryScore(current: number, evidence: MasteryEvidence) {
  const confidence = clamp(evidence.confidence * 100) / 100;
  const impact = clamp(evidence.impact * 100) / 100;
  const factor = reliabilityFactor(evidence.reliability);
  const signal = clamp(35 + confidence * impact * factor * 65);
  const sigma = 22;
  const step = clamp(0.08 + sigma / 200, 0.08, 0.28);
  const next = current + step * (signal - current);
  return Number(clamp(next).toFixed(2));
}

export async function applyEvidenceToStudentMastery(params: {
  studentId: string;
  evidences: MasteryEvidence[];
  calculationVersion: string;
}) {
  const outcomes: NodeMasteryOutcome[] = [];
  const now = new Date();
  for (const evidence of params.evidences) {
    const existing = await prisma.studentGseMastery.findUnique({
      where: {
        studentId_nodeId: {
          studentId: params.studentId,
          nodeId: evidence.nodeId,
        },
      },
      include: {
        node: {
          select: {
            type: true,
            skill: true,
          },
        },
      },
    });

    const previousReliability = (existing?.reliability as GseReliability | null) || "low";
    const reliability: GseReliability =
      previousReliability === "high" || evidence.reliability === "high"
        ? "high"
        : previousReliability === "medium" || evidence.reliability === "medium"
        ? "medium"
        : "low";
    const previousMean = existing?.masteryMean ?? existing?.masteryScore ?? 25;
    const previousSigma = existing?.masterySigma ?? 24;
    const previousHalfLife =
      existing?.halfLifeDays ??
      defaultHalfLifeDays(existing?.node?.type || null, existing?.node?.skill || null);
    const previousCount = existing?.evidenceCount ?? 0;
    const previousDecayed =
      existing?.decayedMastery ??
      computeDecayedMastery({
        masteryMean: previousMean,
        lastEvidenceAt: existing?.lastEvidenceAt ?? null,
        now,
        halfLifeDays: previousHalfLife,
        evidenceCount: previousCount,
        reliability: previousReliability,
      });

    const observation = clamp(
      evidence.confidence * evidence.impact * reliabilityFactor(evidence.reliability) * 100
    );
    const updateRate = clamp(0.08 + previousSigma / 220, 0.08, 0.32);
    const nextMean = Number(clamp(previousDecayed + updateRate * (observation - previousDecayed)).toFixed(2));
    const nextSigma = Number(Math.max(6, previousSigma * (1 - 0.12 * updateRate)).toFixed(2));
    const nextCount = previousCount + 1;
    const nextHalfLife = Number(
      Math.max(previousHalfLife, defaultHalfLifeDays(existing?.node?.type || null, existing?.node?.skill || null))
        .toFixed(2)
    );
    const nextDecayed = computeDecayedMastery({
      masteryMean: nextMean,
      lastEvidenceAt: now,
      now,
      halfLifeDays: nextHalfLife,
      evidenceCount: nextCount,
      reliability,
    });

    await prisma.studentGseMastery.upsert({
      where: {
        studentId_nodeId: {
          studentId: params.studentId,
          nodeId: evidence.nodeId,
        },
      },
      update: {
        masteryScore: nextMean,
        masteryMean: nextMean,
        masterySigma: nextSigma,
        decayedMastery: nextDecayed,
        halfLifeDays: nextHalfLife,
        reliability,
        evidenceCount: nextCount,
        lastEvidenceAt: now,
        calculationVersion: params.calculationVersion,
      },
      create: {
        studentId: params.studentId,
        nodeId: evidence.nodeId,
        masteryScore: nextMean,
        masteryMean: nextMean,
        masterySigma: nextSigma,
        decayedMastery: nextDecayed,
        halfLifeDays: nextHalfLife,
        reliability,
        evidenceCount: nextCount,
        lastEvidenceAt: now,
        calculationVersion: params.calculationVersion,
      },
    });

    outcomes.push({
      nodeId: evidence.nodeId,
      previousMean,
      nextMean,
      previousDecayed,
      nextDecayed,
      deltaMastery: Number((nextMean - previousMean).toFixed(2)),
      decayImpact: Number((previousMean - previousDecayed).toFixed(2)),
      reliability,
      evidenceCount: nextCount,
    });
  }

  return outcomes;
}
