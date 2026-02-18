import { z } from "zod";
import {
  OOD_BUDGET_CONTROLLER_VERSION,
  OOD_BUDGET_MAX_RATE,
  OOD_BUDGET_MIN_RATE,
} from "@/lib/ood/budgetController";

export const oodBudgetLearnerRowSchema = z.object({
  studentId: z.string(),
  totalTasks: z.number().int().nonnegative(),
  oodInjectedTasks: z.number().int().nonnegative(),
  realizedOodRate: z.number().min(0).max(1),
  averageBudgetRate: z.number().min(0).max(1).nullable(),
  averageBudgetInterval: z.number().min(0).max(100).nullable(),
  milestonePressureTasks: z.number().int().nonnegative(),
  overfitRiskTasks: z.number().int().nonnegative(),
  evaluatedOodCount: z.number().int().nonnegative(),
  oodPassCount: z.number().int().nonnegative(),
  oodFailCount: z.number().int().nonnegative(),
  outsideBudgetBand: z.boolean(),
});

export const oodBudgetTelemetryReportSchema = z.object({
  generatedAt: z.string().datetime(),
  controllerVersion: z.literal(OOD_BUDGET_CONTROLLER_VERSION),
  targetBudgetBand: z.object({
    minRate: z.literal(OOD_BUDGET_MIN_RATE),
    maxRate: z.literal(OOD_BUDGET_MAX_RATE),
  }),
  windowDays: z.number().int().positive(),
  totalLearners: z.number().int().nonnegative(),
  summary: z.object({
    totalTasks: z.number().int().nonnegative(),
    totalOodInjectedTasks: z.number().int().nonnegative(),
    realizedOodRate: z.number().min(0).max(1),
    learnersOutsideBudgetBand: z.number().int().nonnegative(),
  }),
  learners: z.array(oodBudgetLearnerRowSchema),
});

export type OodBudgetTelemetryReport = z.infer<typeof oodBudgetTelemetryReportSchema>;
