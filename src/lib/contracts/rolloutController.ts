import { z } from "zod";

export const ROLLOUT_CONTROLLER_VERSION = "rollout-controller-v1" as const;

export const ROLLOUT_PHASES = [
  "shadow_only",
  "ramp_5",
  "ramp_20",
  "ramp_50",
  "full",
  "rolled_back",
] as const;
export type RolloutPhase = (typeof ROLLOUT_PHASES)[number];

export const rolloutStateSchema = z.object({
  policyVersion: z.string(),
  phase: z.enum(ROLLOUT_PHASES),
  updatedAt: z.string().datetime(),
  reason: z.string().optional(),
});
export type RolloutState = z.infer<typeof rolloutStateSchema>;

export const ROLLOUT_DECISIONS = ["hold", "ramp_up", "rollback"] as const;
export type RolloutDecision = (typeof ROLLOUT_DECISIONS)[number];

export const rolloutControllerLogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  contractVersion: z.literal(ROLLOUT_CONTROLLER_VERSION),
  policyVersion: z.string(),
  phase: z.enum(ROLLOUT_PHASES),
  decision: z.enum(ROLLOUT_DECISIONS),
  reason: z.string(),
  metricsSnapshot: z
    .object({
      shadowHighRiskPer1k: z.number().nullable(),
      retentionPassRate: z.number().nullable(),
      transferPassRate: z.number().nullable(),
      retentionSampleSize: z.number().int().nonnegative().optional(),
      transferSampleSize: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type RolloutControllerLogEntry = z.infer<typeof rolloutControllerLogEntrySchema>;
