import { z } from "zod";
import {
  RETENTION_PROBE_GRACE_DAYS,
  RETENTION_PROBE_PROTOCOL_VERSION,
} from "@/lib/retention/probes";

export const RETENTION_COHORT_CONTRACT_VERSION = "retention-cohort-v1" as const;

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);
const nullableDays = z.number().nonnegative().nullable();

const retentionWindowDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(90)]);
const retentionStageSchema = z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
const retentionDomainSchema = z.enum(["vocab", "grammar", "communication", "other"]);

export const retentionCohortWindowRowSchema = z.object({
  windowDays: retentionWindowDaysSchema,
  dueProbeCount: nonNegativeInt,
  evaluatedProbeCount: nonNegativeInt,
  passedCount: nonNegativeInt,
  failedCount: nonNegativeInt,
  missedFollowUpCount: nonNegativeInt,
  passRate: boundedRate.nullable(),
  completionRate: boundedRate.nullable(),
});

export const retentionCohortRowSchema = z.object({
  windowDays: retentionWindowDaysSchema,
  stage: retentionStageSchema,
  domain: retentionDomainSchema,
  dueProbeCount: nonNegativeInt,
  pendingProbeCount: nonNegativeInt,
  evaluatedProbeCount: nonNegativeInt,
  passedCount: nonNegativeInt,
  failedCount: nonNegativeInt,
  missedFollowUpCount: nonNegativeInt,
  passRate: boundedRate.nullable(),
  completionRate: boundedRate.nullable(),
  medianFollowUpLagDays: nullableDays,
  uniqueStudents: nonNegativeInt,
  uniqueNodes: nonNegativeInt,
});

export const retentionCohortReportSchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(RETENTION_COHORT_CONTRACT_VERSION),
  protocolVersion: z.literal(RETENTION_PROBE_PROTOCOL_VERSION),
  graceDays: z.literal(RETENTION_PROBE_GRACE_DAYS),
  windowDays: z.number().int().positive(),
  totalEvidenceRows: nonNegativeInt,
  totalDueProbeCount: nonNegativeInt,
  totalPendingProbeCount: nonNegativeInt,
  totalEvaluatedProbeCount: nonNegativeInt,
  totalPassedCount: nonNegativeInt,
  totalFailedCount: nonNegativeInt,
  totalMissedFollowUpCount: nonNegativeInt,
  overallPassRate: boundedRate.nullable(),
  overallCompletionRate: boundedRate.nullable(),
  windows: z.array(retentionCohortWindowRowSchema),
  cohorts: z.array(retentionCohortRowSchema),
});

export type RetentionCohortReport = z.infer<typeof retentionCohortReportSchema>;
