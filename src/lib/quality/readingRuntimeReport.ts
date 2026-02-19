import { prisma } from "@/lib/db";
import {
  READING_RUNTIME_REPORT_VERSION,
  readingRuntimeReportSchema,
  type ReadingRuntimeReport,
} from "@/lib/contracts/readingRuntimeReport";
import { isReadingTaskType } from "@/lib/reading/assessment";

const DAY_MS = 24 * 60 * 60 * 1000;

type AttemptRow = {
  id: string;
  studentId: string;
  taskId: string;
  createdAt: Date;
  taskEvaluationJson: unknown;
  scoresJson: unknown;
  task: {
    type: string;
    metaJson: unknown;
  } | null;
};

type StageAccumulator = {
  attemptCount: number;
  passedCount: number;
  taskScoreSum: number;
  taskScoreCount: number;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStage(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "unknown";
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

export function summarizeReadingRuntimeReport(params: {
  rows: AttemptRow[];
  windowDays: number;
  now?: Date;
  sampleLimit?: number;
}): ReadingRuntimeReport {
  const now = params.now || new Date();
  const sampleLimit = Math.max(1, Math.min(100, Math.floor(params.sampleLimit ?? 20)));

  const readingRows = params.rows.filter((row) => isReadingTaskType(row.task?.type || ""));
  const taskScores: number[] = [];
  const readingScores: number[] = [];
  const sourceScores: number[] = [];
  const questionScores: number[] = [];
  let passCount = 0;

  const byStage = new Map<string, StageAccumulator>();
  const samples: ReadingRuntimeReport["samples"] = [];

  for (const row of readingRows) {
    const taskMeta = asObject(row.task?.metaJson);
    const stage = asStage(taskMeta.stage);
    const taskEvaluation = asObject(row.taskEvaluationJson);
    const artifacts = asObject(taskEvaluation.artifacts);
    const scores = asObject(row.scoresJson);

    const taskScore = asNumber(scores.taskScore) ?? asNumber(taskEvaluation.taskScore);
    const readingComprehensionScore = asNumber(artifacts.readingComprehensionScore);
    const sourceGroundingScore = asNumber(artifacts.readingSourceGroundingScore);
    const questionAddressingScore = asNumber(artifacts.readingQuestionAddressingScore);

    if (typeof taskScore === "number") {
      taskScores.push(taskScore);
      if (taskScore >= 65) passCount += 1;
    }
    if (typeof readingComprehensionScore === "number") readingScores.push(readingComprehensionScore);
    if (typeof sourceGroundingScore === "number") sourceScores.push(sourceGroundingScore);
    if (typeof questionAddressingScore === "number") questionScores.push(questionAddressingScore);

    const stageBucket = byStage.get(stage) || {
      attemptCount: 0,
      passedCount: 0,
      taskScoreSum: 0,
      taskScoreCount: 0,
    };
    stageBucket.attemptCount += 1;
    if (typeof taskScore === "number") {
      stageBucket.taskScoreSum += taskScore;
      stageBucket.taskScoreCount += 1;
      if (taskScore >= 65) stageBucket.passedCount += 1;
    }
    byStage.set(stage, stageBucket);

    if (samples.length < sampleLimit) {
      samples.push({
        attemptId: row.id,
        studentId: row.studentId,
        taskId: row.taskId,
        createdAt: row.createdAt.toISOString(),
        stage,
        taskScore,
        readingComprehensionScore,
        sourceGroundingScore,
        questionAddressingScore,
      });
    }
  }

  const byStageRows = [...byStage.entries()]
    .sort((a, b) => b[1].attemptCount - a[1].attemptCount || a[0].localeCompare(b[0]))
    .map(([stage, acc]) => ({
      stage,
      attemptCount: acc.attemptCount,
      avgTaskScore:
        acc.taskScoreCount > 0
          ? Number((acc.taskScoreSum / acc.taskScoreCount).toFixed(6))
          : null,
      passRate: ratioOrNull(acc.passedCount, acc.taskScoreCount),
    }));

  const totalAttempts = params.rows.length;
  const readingAttempts = readingRows.length;

  return readingRuntimeReportSchema.parse({
    generatedAt: now.toISOString(),
    contractVersion: READING_RUNTIME_REPORT_VERSION,
    windowDays: params.windowDays,
    totalAttempts,
    readingAttempts,
    readingAttemptShare:
      totalAttempts > 0 ? Number((readingAttempts / totalAttempts).toFixed(6)) : 0,
    avgTaskScore: average(taskScores),
    avgReadingComprehensionScore: average(readingScores),
    avgSourceGroundingScore: average(sourceScores),
    avgQuestionAddressingScore: average(questionScores),
    passRate: ratioOrNull(passCount, taskScores.length),
    byStage: byStageRows,
    samples,
  });
}

export async function buildReadingRuntimeReport(params?: {
  windowDays?: number;
  limit?: number;
  sampleLimit?: number;
  now?: Date;
}): Promise<ReadingRuntimeReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const sampleLimit = Math.max(1, Math.min(100, Math.floor(params?.sampleLimit ?? 20)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.attempt.findMany({
    where: {
      createdAt: { gte: since },
      status: "completed",
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      studentId: true,
      taskId: true,
      createdAt: true,
      taskEvaluationJson: true,
      scoresJson: true,
      task: {
        select: {
          type: true,
          metaJson: true,
        },
      },
    },
  });

  return summarizeReadingRuntimeReport({
    rows,
    windowDays,
    now,
    sampleLimit,
  });
}
