import { z } from "zod";

export const LISTENING_TRANSFER_RETENTION_REPORT_VERSION =
  "listening-transfer-retention-report-v1" as const;

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);
const boundedScore = z.number().min(0).max(100);

export const listeningTransferRetentionStageRowSchema = z.object({
  stage: z.string(),
  attempts: nonNegativeInt,
  avgTaskScore: boundedScore.nullable(),
  passRate: boundedRate.nullable(),
});

export const listeningTransferRetentionReportSchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(LISTENING_TRANSFER_RETENTION_REPORT_VERSION),
  windowDays: z.number().int().positive(),
  totalAttempts: nonNegativeInt,
  listeningAttempts: nonNegativeInt,
  scoredListeningAttempts: nonNegativeInt,
  avgTaskScore: boundedScore.nullable(),
  passRate: boundedRate.nullable(),
  transfer: z.object({
    evaluableCount: nonNegativeInt,
    passCount: nonNegativeInt,
    failCount: nonNegativeInt,
    passRate: boundedRate.nullable(),
  }),
  retention: z.object({
    window7dCount: nonNegativeInt,
    window7dPassRate: boundedRate.nullable(),
    window30dCount: nonNegativeInt,
    window30dPassRate: boundedRate.nullable(),
  }),
  byStage: z.array(listeningTransferRetentionStageRowSchema),
});

export type ListeningTransferRetentionReport = z.infer<
  typeof listeningTransferRetentionReportSchema
>;
