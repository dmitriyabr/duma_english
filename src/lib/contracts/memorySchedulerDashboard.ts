import { z } from "zod";
import { MEMORY_SCHEDULER_VERSION } from "@/lib/memory/scheduler";

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);
const nullableHours = z.number().nonnegative().nullable();

export const memorySchedulerPortfolioRowSchema = z.object({
  portfolio: z.enum(["fresh", "review", "transfer"]),
  openCount: nonNegativeInt,
  overdueOpenCount: nonNegativeInt,
  completedCount: nonNegativeInt,
  dueMissCount: nonNegativeInt,
  medianResolutionLatencyHours: nullableHours,
  medianOpenAgeHours: nullableHours,
});

export const memorySchedulerDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  schedulerVersion: z.literal(MEMORY_SCHEDULER_VERSION),
  windowDays: z.number().int().positive(),
  totalQueueItems: nonNegativeInt,
  openCount: nonNegativeInt,
  overdueOpenCount: nonNegativeInt,
  dueMissCount: nonNegativeInt,
  dueMissRate: boundedRate.nullable(),
  medianResolutionLatencyHours: nullableHours,
  medianOpenAgeHours: nullableHours,
  fragileOpenCount: nonNegativeInt,
  portfolio: z.array(memorySchedulerPortfolioRowSchema),
  reasonBreakdown: z.array(
    z.object({
      key: z.string(),
      count: nonNegativeInt,
    }),
  ),
});

export type MemorySchedulerDashboardReport = z.infer<typeof memorySchedulerDashboardSchema>;
