import { prisma } from "@/lib/db";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function readTaskScore(taskEvaluationJson: unknown) {
  const row = asObject(taskEvaluationJson);
  const value = row.taskScore;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const GSE_QUALITY_THRESHOLDS = {
  lowScoreWithoutNegativeRate: 0.1,
  grammarOverweightRate: 0.1,
  vocabFalsePositiveRate: 0.08,
} as const;

export async function runFalsePositiveVocabCheck() {
  const totalMastered = await prisma.studentGseMastery.count({
    where: {
      node: { type: "GSE_VOCAB" },
      masteryScore: { gte: 80 },
    },
  });
  const suspicious = await prisma.studentGseMastery.findMany({
    where: {
      node: { type: "GSE_VOCAB" },
      masteryScore: { gte: 80 },
      directEvidenceCount: { lt: 2 },
    },
    include: {
      node: { select: { nodeId: true, descriptor: true } },
    },
    orderBy: [{ masteryScore: "desc" }],
    take: 50,
  });
  return {
    totalMastered,
    suspiciousCount: suspicious.length,
    suspiciousRate: totalMastered > 0 ? Number((suspicious.length / totalMastered).toFixed(4)) : 0,
    examples: suspicious.slice(0, 10).map((row) => ({
      studentId: row.studentId,
      nodeId: row.nodeId,
      nodeLabel: row.node.descriptor,
      masteryScore: row.masteryScore,
      directEvidenceCount: row.directEvidenceCount,
      crossTaskEvidenceCount: row.crossTaskEvidenceCount,
      reliability: row.reliability,
    })),
  };
}

export async function runGrammarIncidentalOverweightCheck() {
  const totalMastered = await prisma.studentGseMastery.count({
    where: {
      node: { type: "GSE_GRAMMAR" },
      masteryScore: { gte: 75 },
    },
  });
  const suspicious = await prisma.studentGseMastery.findMany({
    where: {
      node: { type: "GSE_GRAMMAR" },
      masteryScore: { gte: 75 },
      directEvidenceCount: { lte: 1 },
      crossTaskEvidenceCount: { gte: 4 },
    },
    include: {
      node: { select: { nodeId: true, descriptor: true } },
    },
    orderBy: [{ masteryScore: "desc" }],
    take: 50,
  });
  return {
    totalMastered,
    suspiciousCount: suspicious.length,
    suspiciousRate: totalMastered > 0 ? Number((suspicious.length / totalMastered).toFixed(4)) : 0,
    examples: suspicious.slice(0, 10).map((row) => ({
      studentId: row.studentId,
      nodeId: row.nodeId,
      nodeLabel: row.node.descriptor,
      masteryScore: row.masteryScore,
      directEvidenceCount: row.directEvidenceCount,
      crossTaskEvidenceCount: row.crossTaskEvidenceCount,
      reliability: row.reliability,
    })),
  };
}

export async function runLoConsistencyCheck() {
  const attempts = await prisma.attempt.findMany({
    where: { status: "completed" },
    select: {
      id: true,
      studentId: true,
      taskEvaluationJson: true,
      gseEvidence: {
        select: {
          evidenceKind: true,
          opportunityType: true,
          domain: true,
          usedForPromotion: true,
          nodeId: true,
          metadataJson: true,
        },
      },
    },
    orderBy: { completedAt: "desc" },
    take: 1000,
  });
  const highScoreWithNegative: Array<{ attemptId: string; studentId: string; taskScore: number; negativeCount: number }> = [];
  const lowScoreWithoutNegative: Array<{ attemptId: string; studentId: string; taskScore: number }> = [];
  const repairedConsistency: Array<{ attemptId: string; studentId: string; taskScore: number }> = [];

  for (const attempt of attempts) {
    const taskScore = readTaskScore(attempt.taskEvaluationJson);
    if (taskScore === null) continue;
    const loNegative = attempt.gseEvidence.filter(
      (row) =>
        row.domain === "lo" &&
        row.evidenceKind === "negative" &&
        row.opportunityType === "explicit_target" &&
        row.usedForPromotion
    );
    if (taskScore >= 80 && loNegative.length > 0) {
      highScoreWithNegative.push({
        attemptId: attempt.id,
        studentId: attempt.studentId,
        taskScore,
        negativeCount: loNegative.length,
      });
    }
    if (taskScore <= 45 && loNegative.length === 0) {
      lowScoreWithoutNegative.push({
        attemptId: attempt.id,
        studentId: attempt.studentId,
        taskScore,
      });
    }
    const hasRepairFlag = attempt.gseEvidence.some((row) => {
      if (!row.metadataJson || typeof row.metadataJson !== "object") return false;
      return (row.metadataJson as Record<string, unknown>).consistencyFlag === "inconsistent_lo_signal_repaired";
    });
    if (hasRepairFlag) {
      repairedConsistency.push({
        attemptId: attempt.id,
        studentId: attempt.studentId,
        taskScore,
      });
    }
  }

  const evaluated = attempts.filter((attempt) => readTaskScore(attempt.taskEvaluationJson) !== null).length;
  return {
    evaluatedAttempts: evaluated,
    highScoreWithNegativeCount: highScoreWithNegative.length,
    lowScoreWithoutNegativeCount: lowScoreWithoutNegative.length,
    highScoreWithNegativeRate:
      evaluated > 0 ? Number((highScoreWithNegative.length / evaluated).toFixed(4)) : 0,
    lowScoreWithoutNegativeRate:
      evaluated > 0 ? Number((lowScoreWithoutNegative.length / evaluated).toFixed(4)) : 0,
    consistencyRepairRate:
      evaluated > 0 ? Number((repairedConsistency.length / evaluated).toFixed(4)) : 0,
    examples: {
      highScoreWithNegative: highScoreWithNegative.slice(0, 10),
      lowScoreWithoutNegative: lowScoreWithoutNegative.slice(0, 10),
      repairedConsistency: repairedConsistency.slice(0, 10),
    },
  };
}

export async function buildGseQualityReport() {
  const startedAt = Date.now();
  const [vocabFalsePositive, grammarOverweight, loConsistency] = await Promise.all([
    runFalsePositiveVocabCheck(),
    runGrammarIncidentalOverweightCheck(),
    runLoConsistencyCheck(),
  ]);
  const breaches = {
    vocabFalsePositiveRate: vocabFalsePositive.suspiciousRate > GSE_QUALITY_THRESHOLDS.vocabFalsePositiveRate,
    grammarOverweightRate: grammarOverweight.suspiciousRate > GSE_QUALITY_THRESHOLDS.grammarOverweightRate,
    lowScoreWithoutNegativeRate:
      loConsistency.lowScoreWithoutNegativeRate > GSE_QUALITY_THRESHOLDS.lowScoreWithoutNegativeRate,
  };
  const correctiveDomain =
    breaches.lowScoreWithoutNegativeRate ? "lo" : breaches.grammarOverweightRate ? "grammar" : breaches.vocabFalsePositiveRate ? "vocab" : null;

  return {
    generatedAt: new Date().toISOString(),
    elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    thresholds: GSE_QUALITY_THRESHOLDS,
    breaches,
    correctivePolicy: {
      active: Boolean(correctiveDomain),
      domain: correctiveDomain,
      diagnosticModeForced: Boolean(correctiveDomain),
      evidenceRuleVersion: "gse-evidence-v2.1",
    },
    checks: {
      vocabFalsePositive,
      grammarOverweight,
      loConsistency,
    },
  };
}
