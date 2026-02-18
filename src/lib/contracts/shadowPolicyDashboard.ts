import { z } from "zod";

export const SHADOW_POLICY_MODEL_VERSION = "shadow-linear-contextual-v1" as const;

export const shadowPriorRowSchema = z.object({
  taskType: z.string(),
  count: z.number().int().nonnegative(),
  meanReward: z.number(),
  shrinkedReward: z.number(),
});

export const shadowCandidateScoreSchema = z.object({
  taskType: z.string(),
  shadowValue: z.number(),
  priorReward: z.number(),
  featureContribution: z.number(),
  safetyFlags: z.array(z.string()),
});

export const shadowSafetyCountersSchema = z.object({
  highRiskDisagreementCount: z.number().int().nonnegative(),
  verificationGuardTrips: z.number().int().nonnegative(),
  blockedBySafetyGuardCount: z.number().int().nonnegative(),
});

export const shadowPolicyTraceSchema = z.object({
  modelVersion: z.literal(SHADOW_POLICY_MODEL_VERSION),
  generatedAt: z.string().datetime(),
  trainingWindowDays: z.number().int().positive(),
  trainingSampleSize: z.number().int().nonnegative(),
  priorGlobalMean: z.number(),
  priorByTaskType: z.array(shadowPriorRowSchema),
  rulesChosenTaskType: z.string(),
  shadowChosenTaskType: z.string().nullable(),
  shadowChosenTaskTypeAfterSafety: z.string().nullable(),
  disagreement: z.boolean(),
  disagreementAfterSafety: z.boolean(),
  valueGapVsRules: z.number().nullable(),
  blockedBySafetyGuard: z.boolean(),
  safetyGuardReasons: z.array(z.string()),
  safetyCounters: shadowSafetyCountersSchema,
  candidateScores: z.array(shadowCandidateScoreSchema),
});

export const shadowPolicyDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  windowDays: z.number().int().positive(),
  totalDecisions: z.number().int().nonnegative(),
  tracedDecisions: z.number().int().nonnegative(),
  traceCoverageRate: z.number().min(0).max(1),
  disagreementRate: z.number().min(0).max(1),
  disagreementAfterSafetyRate: z.number().min(0).max(1),
  blockedBySafetyGuardRate: z.number().min(0).max(1),
  averageValueGap: z.number().nullable(),
  modelVersions: z.array(
    z.object({
      modelVersion: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
  safetyCounters: shadowSafetyCountersSchema,
  disagreementsByTaskType: z.array(
    z.object({
      taskType: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
});

export type ShadowPolicyTrace = z.infer<typeof shadowPolicyTraceSchema>;
export type ShadowPolicyDashboard = z.infer<typeof shadowPolicyDashboardSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function extractShadowPolicyTraceFromUtilityJson(utilityJson: unknown): ShadowPolicyTrace | null {
  const utility = asRecord(utilityJson);
  const rawTrace = utility.shadowPolicy;
  if (!rawTrace) return null;
  const parsed = shadowPolicyTraceSchema.safeParse(rawTrace);
  if (!parsed.success) return null;
  return parsed.data;
}
