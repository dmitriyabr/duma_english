import { z } from "zod";

export const WRITING_PROGRESSION_DASHBOARD_VERSION =
  "writing-progression-dashboard-v1" as const;

const nonNegativeInt = z.number().int().nonnegative();
const scoreOrNull = z.number().min(0).max(100).nullable();
const rateOrNull = z.number().min(0).max(1).nullable();
const nonNegativeNumberOrNull = z.number().nonnegative().nullable();

export const writingProgressionStageRowSchema = z.object({
  stage: z.string(),
  attempts: nonNegativeInt,
  averageTaskScore: scoreOrNull,
  averageLanguageScore: scoreOrNull,
});

export const writingProgressionTaskTypeRowSchema = z.object({
  taskType: z.string(),
  attempts: nonNegativeInt,
  averageTaskScore: scoreOrNull,
  averageWordCount: nonNegativeNumberOrNull,
});

export const writingProgressionDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(WRITING_PROGRESSION_DASHBOARD_VERSION),
  windowDays: z.number().int().positive(),
  totalWritingAttempts: nonNegativeInt,
  completedWritingAttempts: nonNegativeInt,
  averageTaskScore: scoreOrNull,
  averageLanguageScore: scoreOrNull,
  averageWordCount: nonNegativeNumberOrNull,
  rewriteRecommendedRate: rateOrNull,
  revisionSubmissionRate: rateOrNull,
  byStage: z.array(writingProgressionStageRowSchema),
  byTaskType: z.array(writingProgressionTaskTypeRowSchema),
});

export type WritingProgressionDashboard = z.infer<typeof writingProgressionDashboardSchema>;
