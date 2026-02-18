import { z } from "zod";
import { OFFLINE_REPLAY_DATASET_VERSION } from "@/lib/replay/offlineDataset";

const nonNegativeInt = z.number().int().nonnegative();

export const replayDatasetMissingStatsSchema = z.object({
  missingDecisionEvent: nonNegativeInt,
  missingTaskInstanceEvent: nonNegativeInt,
  missingAttemptEvent: nonNegativeInt,
  missingDelayedOutcomeEvent: nonNegativeInt,
  missingOutcomePayload: nonNegativeInt,
  missingLinkage: nonNegativeInt,
});

export const replayDatasetCompletenessSampleSchema = z.object({
  decisionLogId: z.string(),
  studentId: z.string().nullable(),
  missing: z.array(z.string()).min(1),
  timestamps: z.object({
    decisionTs: z.string().datetime().nullable(),
    delayedOutcomeTs: z.string().datetime().nullable(),
  }),
});

export const replayDatasetCompletenessReportSchema = z.object({
  generatedAt: z.string().datetime(),
  datasetVersion: z.literal(OFFLINE_REPLAY_DATASET_VERSION),
  windowDays: z.number().int().positive(),
  eventLimit: z.number().int().positive(),
  decisionLimit: z.number().int().positive(),
  summary: z.object({
    totalEvents: nonNegativeInt,
    totalDecisionGroups: nonNegativeInt,
    completeRows: nonNegativeInt,
    incompleteRows: nonNegativeInt,
    completenessRate: z.number().min(0).max(1),
    eventTypeCounts: z.record(nonNegativeInt),
    missing: replayDatasetMissingStatsSchema,
  }),
  incompleteSamples: z.array(replayDatasetCompletenessSampleSchema),
});

export type ReplayDatasetCompletenessReport = z.infer<typeof replayDatasetCompletenessReportSchema>;
