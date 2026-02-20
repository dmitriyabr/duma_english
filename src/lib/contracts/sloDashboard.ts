import { z } from "zod";

export const SLO_DASHBOARD_CONTRACT_VERSION = "slo-dashboard-v1" as const;

export const sloModuleIdSchema = z.enum(["planner"]);
export type SloModuleId = z.infer<typeof sloModuleIdSchema>;

export const sloStatusSchema = z.enum(["ok", "breach", "insufficient_data"]);
export type SloStatus = z.infer<typeof sloStatusSchema>;

export const sloModuleStatusSchema = z.object({
  moduleId: sloModuleIdSchema,
  label: z.string(),
  latencyBudgetP95Ms: z.number().finite().positive().nullable(),
  latencyP95Ms: z.number().finite().nullable(),
  latencySampleSize: z.number().int().min(0),
  reliabilityMin: z.number().finite().min(0).max(1).nullable(),
  reliabilityActual: z.number().finite().nullable(),
  reliabilitySampleSize: z.number().int().min(0).optional(),
  status: sloStatusSchema,
  updatedAt: z.string().datetime({ offset: true }),
});
export type SloModuleStatus = z.infer<typeof sloModuleStatusSchema>;

export const sloDashboardSchema = z.object({
  contractVersion: z.literal(SLO_DASHBOARD_CONTRACT_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  windowDays: z.number().int().positive(),
  modules: z.array(sloModuleStatusSchema),
  enforcementActive: z.boolean().optional(),
});
export type SloDashboard = z.infer<typeof sloDashboardSchema>;

export const SLO_PLANNER_P95_MS_DEFAULT = 5000;
export const SLO_PLANNER_WINDOW_DAYS_DEFAULT = 1;
