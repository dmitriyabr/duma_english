import { z } from "zod";

export const OPERATIONAL_PLAYBOOKS_CONTRACT_VERSION = "operational-playbooks-v1" as const;

export const runbookIdSchema = z.enum([
  "retry_loop",
  "cause_plateau",
  "weak_transfer_high_indomain",
  "fast_progress_low_reliability",
]);
export type RunbookId = z.infer<typeof runbookIdSchema>;

export const playbookTriggerContextSchema = z.object({
  /** Human-readable reason (e.g. "3 NEEDS_RETRY in last 5 attempts") */
  reason: z.string(),
  /** Optional numeric context (e.g. retryCount, sameCauseCount) */
  count: z.number().int().min(0).optional(),
  /** Optional window (e.g. "last 5 attempts", "7d") */
  window: z.string().optional(),
});
export type PlaybookTriggerContext = z.infer<typeof playbookTriggerContextSchema>;

export const playbookTriggerSchema = z.object({
  runbookId: runbookIdSchema,
  studentId: z.string().min(1),
  triggeredAt: z.string().datetime({ offset: true }),
  context: playbookTriggerContextSchema,
});
export type PlaybookTrigger = z.infer<typeof playbookTriggerSchema>;

export const incidentOutcomeStatusSchema = z.enum(["open", "resolved", "unknown"]);
export type IncidentOutcomeStatus = z.infer<typeof incidentOutcomeStatusSchema>;

export const incidentOutcomeSchema = z.object({
  trigger: playbookTriggerSchema,
  outcomeStatus: incidentOutcomeStatusSchema.optional(),
  outcomeAt: z.string().datetime({ offset: true }).optional(),
  outcomeNote: z.string().optional(),
});
export type IncidentOutcome = z.infer<typeof incidentOutcomeSchema>;

export const operationalPlaybooksReportSchema = z.object({
  contractVersion: z.literal(OPERATIONAL_PLAYBOOKS_CONTRACT_VERSION),
  generatedAt: z.string().datetime({ offset: true }),
  window: z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    windowDays: z.number().int().positive(),
  }),
  incidents: z.array(incidentOutcomeSchema),
  summary: z.object({
    retry_loop: z.number().int().min(0),
    cause_plateau: z.number().int().min(0),
    weak_transfer_high_indomain: z.number().int().min(0),
    fast_progress_low_reliability: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
});
export type OperationalPlaybooksReport = z.infer<typeof operationalPlaybooksReportSchema>;
