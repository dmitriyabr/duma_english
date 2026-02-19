import { z } from "zod";

export const READING_RUNTIME_REPORT_VERSION = "reading-runtime-report-v1" as const;

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);
const boundedScore = z.number().min(0).max(100);

export const readingRuntimeSampleSchema = z.object({
  attemptId: z.string(),
  studentId: z.string(),
  taskId: z.string(),
  createdAt: z.string().datetime(),
  stage: z.string(),
  taskScore: boundedScore.nullable(),
  readingComprehensionScore: boundedScore.nullable(),
  sourceGroundingScore: boundedScore.nullable(),
  questionAddressingScore: boundedScore.nullable(),
});

export const readingRuntimeStageRowSchema = z.object({
  stage: z.string(),
  attemptCount: nonNegativeInt,
  avgTaskScore: boundedScore.nullable(),
  passRate: boundedRate.nullable(),
});

export const readingRuntimeReportSchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(READING_RUNTIME_REPORT_VERSION),
  windowDays: z.number().int().positive(),
  totalAttempts: nonNegativeInt,
  readingAttempts: nonNegativeInt,
  readingAttemptShare: boundedRate,
  avgTaskScore: boundedScore.nullable(),
  avgReadingComprehensionScore: boundedScore.nullable(),
  avgSourceGroundingScore: boundedScore.nullable(),
  avgQuestionAddressingScore: boundedScore.nullable(),
  passRate: boundedRate.nullable(),
  byStage: z.array(readingRuntimeStageRowSchema),
  samples: z.array(readingRuntimeSampleSchema),
});

export type ReadingRuntimeReport = z.infer<typeof readingRuntimeReportSchema>;
