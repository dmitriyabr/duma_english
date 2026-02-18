import { prisma } from "@/lib/db";
import {
  DISCOURSE_PRAGMATICS_DIMENSIONS,
  DISCOURSE_PRAGMATICS_PASS_THRESHOLD,
  DISCOURSE_PRAGMATICS_VERSION,
  adjudicateDiscoursePragmatics,
  evaluateDiscoursePragmatics,
  isDiscoursePragmaticsTaskType,
  type DiscourseDimensionKey,
} from "@/lib/discourse/pragmatics";
import {
  discoursePragmaticsBenchmarkReportSchema,
  type DiscoursePragmaticsBenchmarkReport,
  DISCOURSE_PRAGMATICS_BENCHMARK_VERSION,
} from "@/lib/contracts/discoursePragmaticsBenchmarkReport";

const DAY_MS = 24 * 60 * 60 * 1000;

type AttemptRow = {
  transcript: string | null;
  taskEvaluationJson: unknown;
  task: {
    type: string;
    prompt: string;
  } | null;
};

type DimensionAccumulator = {
  coverageCount: number;
  enginePassCount: number;
  adjudicatedPassCount: number;
  agreementCount: number;
  absoluteErrorSum: number;
};

type TaskTypeAccumulator = {
  count: number;
  agreementSum: number;
};

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readEngineScoresFromArtifacts(taskEvaluationJson: unknown) {
  const taskEvaluation = asObject(taskEvaluationJson);
  const artifacts = asObject(taskEvaluation.artifacts);
  const discourse = asObject(artifacts.discoursePragmatics);
  const scores = asObject(discourse.scores);

  const result: Partial<Record<DiscourseDimensionKey, number>> = {};
  for (const dimension of DISCOURSE_PRAGMATICS_DIMENSIONS) {
    const value = scores[dimension];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[dimension] = value;
    }
  }

  const hasCompleteScores = DISCOURSE_PRAGMATICS_DIMENSIONS.every(
    (dimension) => typeof result[dimension] === "number",
  );
  if (!hasCompleteScores) return null;

  return result as Record<DiscourseDimensionKey, number>;
}

function evaluateAttemptAgreement(params: {
  taskType: string;
  transcript: string;
  taskPrompt: string;
  taskEvaluationJson: unknown;
}) {
  const engineScoresFromArtifacts = readEngineScoresFromArtifacts(params.taskEvaluationJson);
  const engine = engineScoresFromArtifacts
    ? {
        scores: engineScoresFromArtifacts,
      }
    : evaluateDiscoursePragmatics({
        taskType: params.taskType,
        transcript: params.transcript,
        taskPrompt: params.taskPrompt,
      });

  const adjudicated = adjudicateDiscoursePragmatics({
    taskType: params.taskType,
    transcript: params.transcript,
    taskPrompt: params.taskPrompt,
  });

  const agreementByDimension = DISCOURSE_PRAGMATICS_DIMENSIONS.map((dimension) => {
    const engineScore = engine.scores[dimension];
    const adjudicatedScore = adjudicated.scores[dimension];
    const enginePass = engineScore >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD;
    const adjudicatedPass = adjudicatedScore >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD;
    return {
      dimension,
      engineScore,
      adjudicatedScore,
      enginePass,
      adjudicatedPass,
      agreement: enginePass === adjudicatedPass,
    };
  });

  const agreementRate =
    agreementByDimension.filter((row) => row.agreement).length /
    agreementByDimension.length;

  return {
    hasEngineOutput: Boolean(engineScoresFromArtifacts),
    agreementByDimension,
    agreementRate,
  };
}

export function summarizeDiscoursePragmaticsBenchmark(params: {
  rows: AttemptRow[];
  windowDays: number;
  now?: Date;
}): DiscoursePragmaticsBenchmarkReport {
  const now = params.now || new Date();

  const dimensionStats = new Map<DiscourseDimensionKey, DimensionAccumulator>();
  const byTaskType = new Map<string, TaskTypeAccumulator>();

  for (const dimension of DISCOURSE_PRAGMATICS_DIMENSIONS) {
    dimensionStats.set(dimension, {
      coverageCount: 0,
      enginePassCount: 0,
      adjudicatedPassCount: 0,
      agreementCount: 0,
      absoluteErrorSum: 0,
    });
  }

  let discourseAttempts = 0;
  let engineCoverageCount = 0;
  let overallAgreementSum = 0;

  for (const row of params.rows) {
    const taskType = row.task?.type || "topic_talk";
    if (!isDiscoursePragmaticsTaskType(taskType)) continue;
    const transcript = (row.transcript || "").trim();
    if (transcript.length === 0) continue;

    discourseAttempts += 1;

    const assessed = evaluateAttemptAgreement({
      taskType,
      transcript,
      taskPrompt: row.task?.prompt || "",
      taskEvaluationJson: row.taskEvaluationJson,
    });

    if (assessed.hasEngineOutput) {
      engineCoverageCount += 1;
    }

    overallAgreementSum += assessed.agreementRate;

    const taskBucket = byTaskType.get(taskType) || { count: 0, agreementSum: 0 };
    taskBucket.count += 1;
    taskBucket.agreementSum += assessed.agreementRate;
    byTaskType.set(taskType, taskBucket);

    for (const rowByDimension of assessed.agreementByDimension) {
      const acc = dimensionStats.get(rowByDimension.dimension);
      if (!acc) continue;

      acc.coverageCount += 1;
      if (rowByDimension.enginePass) acc.enginePassCount += 1;
      if (rowByDimension.adjudicatedPass) acc.adjudicatedPassCount += 1;
      if (rowByDimension.agreement) acc.agreementCount += 1;
      acc.absoluteErrorSum += Math.abs(
        rowByDimension.engineScore - rowByDimension.adjudicatedScore,
      );
    }
  }

  const dimensions = DISCOURSE_PRAGMATICS_DIMENSIONS.map((dimension) => {
    const acc = dimensionStats.get(dimension)!;
    return {
      dimension,
      coverageCount: acc.coverageCount,
      enginePassRate: ratioOrNull(acc.enginePassCount, acc.coverageCount),
      adjudicatedPassRate: ratioOrNull(acc.adjudicatedPassCount, acc.coverageCount),
      agreementRate: ratioOrNull(acc.agreementCount, acc.coverageCount),
      meanAbsoluteError:
        acc.coverageCount > 0
          ? Number((acc.absoluteErrorSum / acc.coverageCount).toFixed(4))
          : null,
    };
  });

  const byTaskTypeRows = [...byTaskType.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([taskType, acc]) => ({
      taskType,
      count: acc.count,
      agreementRate: ratioOrNull(acc.agreementSum, acc.count),
    }));

  return discoursePragmaticsBenchmarkReportSchema.parse({
    generatedAt: now.toISOString(),
    contractVersion: DISCOURSE_PRAGMATICS_BENCHMARK_VERSION,
    engineVersion: DISCOURSE_PRAGMATICS_VERSION,
    windowDays: params.windowDays,
    totalAttempts: params.rows.length,
    discourseAttempts,
    engineCoverageCount,
    engineCoverageRate: ratioOrNull(engineCoverageCount, discourseAttempts),
    overallAgreementRate: ratioOrNull(overallAgreementSum, discourseAttempts),
    dimensions,
    byTaskType: byTaskTypeRows,
  });
}

export async function buildDiscoursePragmaticsBenchmarkReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<DiscoursePragmaticsBenchmarkReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.attempt.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ["completed", "needs_retry"] },
      transcript: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      transcript: true,
      taskEvaluationJson: true,
      task: {
        select: {
          type: true,
          prompt: true,
        },
      },
    },
  });

  return summarizeDiscoursePragmaticsBenchmark({
    rows,
    windowDays,
    now,
  });
}
