import { z } from "zod";
import { SELF_REPAIR_BUDGET_GUARDRAILS_VERSION } from "@/lib/selfRepair/budgetGuardrails";

const nonNegativeInt = z.number().int().nonnegative();

export const selfRepairBudgetReasonRowSchema = z.object({
  reason: z.string(),
  count: nonNegativeInt,
});

export const selfRepairBudgetTelemetryReportSchema = z.object({
  generatedAt: z.string().datetime(),
  guardrailsVersion: z.literal(SELF_REPAIR_BUDGET_GUARDRAILS_VERSION),
  windowDays: z.number().int().positive(),
  totalCycles: nonNegativeInt,
  budgetExhaustedCount: nonNegativeInt,
  budgetExhaustedRate: z.number().min(0).max(1),
  escalatedCount: nonNegativeInt,
  escalationQueueOpenCount: nonNegativeInt,
  escalationQueueCompletedCount: nonNegativeInt,
  averageProjectedImmediateShare: z.number().min(0).max(1).nullable(),
  maxProjectedImmediateShare: z.number().min(0).max(1).nullable(),
  averageLoopsUsedPerSkillSession: z.number().nonnegative().nullable(),
  reasons: z.array(selfRepairBudgetReasonRowSchema),
});

export type SelfRepairBudgetTelemetryReport = z.infer<typeof selfRepairBudgetTelemetryReportSchema>;
