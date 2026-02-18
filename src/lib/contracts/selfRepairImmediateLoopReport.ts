import { z } from "zod";

export const selfRepairImmediateLoopReportSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.literal("self-repair-immediate-v1"),
  windowDays: z.number().int().positive(),
  totalCycles: z.number().int().nonnegative(),
  immediateCompletedCount: z.number().int().nonnegative(),
  immediateCompletionRate: z.number().min(0).max(1),
  pendingImmediateCount: z.number().int().nonnegative(),
  pendingDelayedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  escalatedCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  medianImmediateLatencyMinutes: z.number().nullable(),
  causeLabels: z.array(
    z.object({
      causeLabel: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
});

export type SelfRepairImmediateLoopReport = z.infer<typeof selfRepairImmediateLoopReportSchema>;
