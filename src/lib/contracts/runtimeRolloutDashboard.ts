import { z } from "zod";

const nonNegativeInt = z.number().int().nonnegative();
const nullableRate = z.number().min(0).max(1).nullable();

export const runtimeFeatureFlagsSchema = z.object({
  listening_runtime_v2: z.boolean(),
  retention_gate_v2: z.boolean(),
  memory_runtime_v1: z.boolean(),
  policy_gate_v1: z.boolean(),
  shadow_model_v2: z.boolean(),
});

export const runtimeRolloutDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  windowDays: z.number().int().positive(),
  flags: runtimeFeatureFlagsSchema,
  listeningAuthenticity: z.object({
    tasksIssued: nonNegativeInt,
    withAudioPayload: nonNegativeInt,
    promptLeakCount: nonNegativeInt,
    scriptLeakRate: nullableRate,
  }),
  memoryRuntime: z.object({
    decisions: nonNegativeInt,
    backlogDecisions: nonNegativeInt,
    backlogHitDecisions: nonNegativeInt,
    backlogHitRate: nullableRate,
    dueOverrideCount: nonNegativeInt,
  }),
  causalCoach: z.object({
    completedAttempts: nonNegativeInt,
    withCausalDiagnosis: nonNegativeInt,
    exposureRate: nullableRate,
    topLabels: z.array(
      z.object({
        label: z.string(),
        count: nonNegativeInt,
      }),
    ),
  }),
  promotionBlocks: z.object({
    audits: nonNegativeInt,
    blockedAudits: nonNegativeInt,
    reasons: z.array(
      z.object({
        reason: z.string(),
        count: nonNegativeInt,
      }),
    ),
  }),
});

export type RuntimeRolloutDashboardReport = z.infer<typeof runtimeRolloutDashboardSchema>;
