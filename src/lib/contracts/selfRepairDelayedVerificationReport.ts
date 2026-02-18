import { z } from "zod";

export const selfRepairDelayedVerificationReportSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.literal("self-repair-delayed-verification-v1"),
  windowDays: z.number().int().positive(),
  staleThresholdHours: z.number().int().positive(),
  totalCycles: z.number().int().nonnegative(),
  pendingDelayedCount: z.number().int().nonnegative(),
  delayedAttemptLinkedCount: z.number().int().nonnegative(),
  validVerificationCount: z.number().int().nonnegative(),
  invalidVerificationCount: z.number().int().nonnegative(),
  invalidDuplicateTaskFamilyCount: z.number().int().nonnegative(),
  invalidDuplicatePromptCount: z.number().int().nonnegative(),
  missingDelayedVerificationCount: z.number().int().nonnegative(),
  invalidRate: z.number().min(0).max(1),
  reasonCounts: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
});

export type SelfRepairDelayedVerificationReport = z.infer<
  typeof selfRepairDelayedVerificationReportSchema
>;
