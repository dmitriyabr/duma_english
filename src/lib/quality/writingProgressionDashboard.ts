import { prisma } from "@/lib/db";
import {
  WRITING_PROGRESSION_DASHBOARD_VERSION,
  writingProgressionDashboardSchema,
  type WritingProgressionDashboard,
} from "@/lib/contracts/writingProgressionDashboard";

const DAY_MS = 24 * 60 * 60 * 1000;
const WRITING_TASK_TYPES = new Set(["writing_prompt"]);

type WritingAttemptRow = {
  id: string;
  taskId: string;
  status: string;
  speechMetricsJson: unknown;
  scoresJson: unknown;
  taskEvaluationJson: unknown;
  task: {
    type: string;
    metaJson: unknown;
  } | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function averageOrNull(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (valid.length === 0) return null;
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  return Number(mean.toFixed(4));
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

type StageBucket = {
  attempts: number;
  taskScores: Array<number | null>;
  languageScores: Array<number | null>;
};

type TaskTypeBucket = {
  attempts: number;
  taskScores: Array<number | null>;
  wordCounts: Array<number | null>;
};

export function summarizeWritingProgressionDashboard(params: {
  rows: WritingAttemptRow[];
  windowDays: number;
  now?: Date;
}): WritingProgressionDashboard {
  const now = params.now || new Date();
  const writingRows = params.rows.filter((row) => WRITING_TASK_TYPES.has(row.task?.type || ""));
  const completedRows = writingRows.filter((row) => row.status === "completed");

  const stageBuckets = new Map<string, StageBucket>();
  const taskTypeBuckets = new Map<string, TaskTypeBucket>();
  const perTaskAttemptCount = new Map<string, number>();
  let rewriteRecommendedCount = 0;

  for (const row of completedRows) {
    const taskType = row.task?.type || "unknown";
    const taskMeta = asObject(row.task?.metaJson);
    const stage = typeof taskMeta.stage === "string" && taskMeta.stage.trim().length > 0 ? taskMeta.stage : "unknown";
    const scores = asObject(row.scoresJson);
    const taskEvaluation = asObject(row.taskEvaluationJson);
    const artifacts = asObject(taskEvaluation.artifacts);
    const speech = asObject(row.speechMetricsJson);

    const taskScore =
      numberOrNull(taskEvaluation.taskScore) ?? numberOrNull(scores.taskScore);
    const languageScore =
      numberOrNull(taskEvaluation.languageScore) ?? numberOrNull(scores.languageScore);
    const wordCount =
      numberOrNull(artifacts.writingWordCount) ?? numberOrNull(speech.wordCount);

    const stageBucket = stageBuckets.get(stage) || {
      attempts: 0,
      taskScores: [],
      languageScores: [],
    };
    stageBucket.attempts += 1;
    stageBucket.taskScores.push(taskScore);
    stageBucket.languageScores.push(languageScore);
    stageBuckets.set(stage, stageBucket);

    const typeBucket = taskTypeBuckets.get(taskType) || {
      attempts: 0,
      taskScores: [],
      wordCounts: [],
    };
    typeBucket.attempts += 1;
    typeBucket.taskScores.push(taskScore);
    typeBucket.wordCounts.push(wordCount);
    taskTypeBuckets.set(taskType, typeBucket);

    if (artifacts.rewriteRecommended === true) {
      rewriteRecommendedCount += 1;
    }
  }

  for (const row of writingRows) {
    perTaskAttemptCount.set(row.taskId, (perTaskAttemptCount.get(row.taskId) || 0) + 1);
  }
  const revisedTaskCount = [...perTaskAttemptCount.values()].filter((count) => count > 1).length;

  const byStage = [...stageBuckets.entries()]
    .sort((left, right) => right[1].attempts - left[1].attempts)
    .map(([stage, bucket]) => ({
      stage,
      attempts: bucket.attempts,
      averageTaskScore: averageOrNull(bucket.taskScores),
      averageLanguageScore: averageOrNull(bucket.languageScores),
    }));

  const byTaskType = [...taskTypeBuckets.entries()]
    .sort((left, right) => right[1].attempts - left[1].attempts)
    .map(([taskType, bucket]) => ({
      taskType,
      attempts: bucket.attempts,
      averageTaskScore: averageOrNull(bucket.taskScores),
      averageWordCount: averageOrNull(bucket.wordCounts),
    }));

  const averageTaskScore = averageOrNull(
    completedRows.map((row) => {
      const taskEvaluation = asObject(row.taskEvaluationJson);
      const scores = asObject(row.scoresJson);
      return numberOrNull(taskEvaluation.taskScore) ?? numberOrNull(scores.taskScore);
    }),
  );
  const averageLanguageScore = averageOrNull(
    completedRows.map((row) => {
      const taskEvaluation = asObject(row.taskEvaluationJson);
      const scores = asObject(row.scoresJson);
      return numberOrNull(taskEvaluation.languageScore) ?? numberOrNull(scores.languageScore);
    }),
  );
  const averageWordCount = averageOrNull(
    completedRows.map((row) => {
      const taskEvaluation = asObject(row.taskEvaluationJson);
      const artifacts = asObject(taskEvaluation.artifacts);
      const speech = asObject(row.speechMetricsJson);
      return numberOrNull(artifacts.writingWordCount) ?? numberOrNull(speech.wordCount);
    }),
  );

  return writingProgressionDashboardSchema.parse({
    generatedAt: now.toISOString(),
    contractVersion: WRITING_PROGRESSION_DASHBOARD_VERSION,
    windowDays: params.windowDays,
    totalWritingAttempts: writingRows.length,
    completedWritingAttempts: completedRows.length,
    averageTaskScore,
    averageLanguageScore,
    averageWordCount,
    rewriteRecommendedRate: ratioOrNull(rewriteRecommendedCount, completedRows.length),
    revisionSubmissionRate: ratioOrNull(revisedTaskCount, perTaskAttemptCount.size),
    byStage,
    byTaskType,
  });
}

export async function buildWritingProgressionDashboard(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<WritingProgressionDashboard> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.attempt.findMany({
    where: {
      createdAt: { gte: since },
      task: {
        type: {
          in: [...WRITING_TASK_TYPES],
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      taskId: true,
      status: true,
      speechMetricsJson: true,
      scoresJson: true,
      taskEvaluationJson: true,
      task: {
        select: {
          type: true,
          metaJson: true,
        },
      },
    },
  });

  return summarizeWritingProgressionDashboard({
    rows,
    windowDays,
    now,
  });
}
