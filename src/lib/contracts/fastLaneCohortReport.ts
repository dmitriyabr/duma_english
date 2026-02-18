import { z } from "zod";
import { FAST_LANE_PROTOCOL_VERSION } from "@/lib/policy/fastLane";

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);

export const fastLaneCohortMetricsSchema = z.object({
  cohort: z.enum(["fast_lane", "standard"]),
  learners: nonNegativeInt,
  tasks: nonNegativeInt,
  tasksPerLearnerPerDay: z.number().nonnegative(),
  medianInterTaskHours: z.number().nonnegative().nullable(),
  diagnosticTaskRate: boundedRate,
  oodInjectionRate: boundedRate,
  transferFailRate: boundedRate.nullable(),
  needsRetryRate: boundedRate.nullable(),
});

export const fastLaneCohortReportSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.literal(FAST_LANE_PROTOCOL_VERSION),
  windowDays: z.number().int().positive(),
  totalLearners: nonNegativeInt,
  totalTasks: nonNegativeInt,
  cohorts: z.array(fastLaneCohortMetricsSchema),
  deltas: z.object({
    velocityLiftVsStandard: z.number().nullable(),
    diagnosticRateDelta: z.number().nullable(),
    oodInjectionRateDelta: z.number().nullable(),
    transferFailRateDelta: z.number().nullable(),
    needsRetryRateDelta: z.number().nullable(),
  }),
});

export type FastLaneCohortReport = z.infer<typeof fastLaneCohortReportSchema>;
