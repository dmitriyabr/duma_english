import { z } from "zod";

export const CAUSAL_TAXONOMY_V1_VERSION = "causal-taxonomy-v1" as const;

export const causalCoreLabels = [
  "rule_confusion",
  "l1_interference",
  "retrieval_failure",
  "instruction_misread",
  "attention_loss",
  "production_constraint",
  "mixed",
  "unknown",
] as const;
export type CausalCoreLabel = (typeof causalCoreLabels)[number];

const causalCoreLabelSet = new Set<string>(causalCoreLabels);

export const causalLabelAliasMap: Record<string, CausalCoreLabel> = {
  rule_confusion: "rule_confusion",
  grammar_confusion: "rule_confusion",
  grammar_error: "rule_confusion",
  rule_error: "rule_confusion",
  l1_interference: "l1_interference",
  native_language_interference: "l1_interference",
  first_language_interference: "l1_interference",
  retrieval_failure: "retrieval_failure",
  memory_lapse: "retrieval_failure",
  lexical_retrieval_failure: "retrieval_failure",
  instruction_misread: "instruction_misread",
  task_misread: "instruction_misread",
  prompt_misread: "instruction_misread",
  attention_loss: "attention_loss",
  focus_loss: "attention_loss",
  off_task: "attention_loss",
  production_constraint: "production_constraint",
  time_pressure: "production_constraint",
  load_constraint: "production_constraint",
  speech_limit: "production_constraint",
  mixed: "mixed",
  mixed_cause: "mixed",
  multi_cause: "mixed",
  ambiguous: "mixed",
  unknown: "unknown",
  undetermined: "unknown",
  insufficient_evidence: "unknown",
  other: "unknown",
};

function normalizeLabelToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeCausalLabelValue(value: unknown): CausalCoreLabel {
  if (typeof value !== "string") return "unknown";
  const normalized = normalizeLabelToken(value);
  if (causalCoreLabelSet.has(normalized)) return normalized as CausalCoreLabel;
  return causalLabelAliasMap[normalized] || "unknown";
}

export function normalizeCausalLabel(value: string | null | undefined): CausalCoreLabel {
  return normalizeCausalLabelValue(value);
}

export const oodAxisTags = ["topic", "register", "interlocutor", "goal", "format"] as const;

export const selfRepairStatuses = [
  "pending_immediate_retry",
  "pending_delayed_verification",
  "completed",
  "escalated",
  "cancelled",
] as const;

export const reviewQueueStatuses = ["pending", "scheduled", "completed", "expired", "cancelled"] as const;

export const rewardWindows = ["same_session", "day_7", "day_30"] as const;

export const anchorEvalStatuses = ["started", "completed", "failed", "rolled_back"] as const;
export const autopilotEventTypes = [
  "planner_decision_created",
  "task_instance_created",
  "attempt_created",
  "evidence_written",
  "delayed_outcome_recorded",
  "custom",
] as const;

const nonEmptyString = z.string().trim().min(1);
const probability = z.number().min(0).max(1);
const causalLabelSchema = z.preprocess((value) => normalizeCausalLabelValue(value), z.enum(causalCoreLabels));

export const causalDistributionEntrySchema = z.object({
  label: causalLabelSchema,
  p: probability,
});

export const causalDiagnosisContractSchema = z.object({
  attemptId: nonEmptyString,
  studentId: nonEmptyString,
  taxonomyVersion: z.literal(CAUSAL_TAXONOMY_V1_VERSION).default(CAUSAL_TAXONOMY_V1_VERSION),
  modelVersion: nonEmptyString,
  topLabel: causalLabelSchema,
  topProbability: probability,
  entropy: z.number().min(0).optional(),
  topMargin: probability.optional(),
  distribution: z.array(causalDistributionEntrySchema).min(1),
  confidenceInterval: z
    .object({
      lower: probability,
      upper: probability,
    })
    .refine((value) => value.lower <= value.upper, {
      message: "confidence interval lower bound must be <= upper bound",
    })
    .optional(),
  counterfactual: z.record(z.any()).optional(),
});

function readOptionalProbability(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  return null;
}

type LegacyDistributionEntry = {
  label?: unknown;
  cause?: unknown;
  name?: unknown;
  reason?: unknown;
  p?: unknown;
  probability?: unknown;
  prob?: unknown;
  confidence?: unknown;
  score?: unknown;
};

function adaptLegacyDistribution(distribution: unknown): Array<z.infer<typeof causalDistributionEntrySchema>> {
  if (!Array.isArray(distribution)) return [];
  const mapped = distribution
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as LegacyDistributionEntry;
      const label = normalizeCausalLabelValue(row.label ?? row.cause ?? row.name ?? row.reason);
      const p = readOptionalProbability(row.p ?? row.probability ?? row.prob ?? row.confidence ?? row.score);
      if (p === null) return null;
      return { label, p };
    })
    .filter((row): row is { label: CausalCoreLabel; p: number } => row !== null);

  if (mapped.length === 0) return [];
  const total = mapped.reduce((sum, row) => sum + row.p, 0);
  if (total <= 0) return [];
  return mapped.map((row) => ({
    label: row.label,
    p: row.p / total,
  }));
}

export function adaptLegacyCausalDiagnosisPayload(input: Record<string, unknown>) {
  const topLabel = normalizeCausalLabelValue(
    input.topLabel ?? input.topCause ?? input.causeLabel ?? input.cause ?? "unknown"
  );
  const topProbability = readOptionalProbability(input.topProbability ?? input.topP ?? input.top_p) ?? 1;
  const distribution =
    adaptLegacyDistribution(input.distribution ?? input.causes ?? input.causeDistribution) || [];

  const normalizedDistribution =
    distribution.length > 0
      ? distribution
      : [
          {
            label: topLabel,
            p: topProbability,
          },
          {
            label: "unknown" as const,
            p: Math.max(0, 1 - topProbability),
          },
        ].filter((row) => row.p > 0);

  const topFromDistribution = normalizedDistribution.reduce(
    (best, row) => (row.p > best.p ? row : best),
    normalizedDistribution[0]
  );

  return causalDiagnosisContractSchema.parse({
    attemptId: input.attemptId,
    studentId: input.studentId,
    taxonomyVersion: CAUSAL_TAXONOMY_V1_VERSION,
    modelVersion: input.modelVersion ?? input.model ?? "causal-v1",
    topLabel: topFromDistribution.label,
    topProbability: topFromDistribution.p,
    entropy: input.entropy,
    topMargin: input.topMargin ?? input.margin,
    distribution: normalizedDistribution,
    confidenceInterval:
      input.confidenceInterval && typeof input.confidenceInterval === "object"
        ? input.confidenceInterval
        : undefined,
    counterfactual:
      input.counterfactual && typeof input.counterfactual === "object" ? input.counterfactual : undefined,
  });
}

export const learnerTwinSnapshotContractSchema = z.object({
  studentId: nonEmptyString,
  snapshotTs: z.date().optional(),
  source: nonEmptyString.default("attempt_update"),
  placementStage: nonEmptyString.optional(),
  promotionStage: nonEmptyString.optional(),
  masteryProjection: z.record(z.any()),
  uncertaintyHotspots: z.array(nonEmptyString).optional(),
  motivationSignals: z.record(z.number()).optional(),
  frictionSignals: z.record(z.number()).optional(),
  localeProfile: z.record(z.any()).optional(),
});

export const oodTaskSpecContractSchema = z.object({
  studentId: nonEmptyString,
  taskInstanceId: nonEmptyString.optional(),
  decisionLogId: nonEmptyString.optional(),
  axisTags: z.array(z.enum(oodAxisTags)).default([]),
  difficultyAnchor: z.number().optional(),
  inDomainDifficulty: z.number().optional(),
  difficultyDelta: z.number().optional(),
  status: nonEmptyString.default("planned"),
  verdict: nonEmptyString.optional(),
  metadata: z.record(z.any()).optional(),
});

export const selfRepairCycleContractSchema = z.object({
  studentId: nonEmptyString,
  nodeId: nonEmptyString.optional(),
  sourceAttemptId: nonEmptyString,
  immediateAttemptId: nonEmptyString.optional(),
  delayedVerificationAttemptId: nonEmptyString.optional(),
  delayedVerificationTaskInstanceId: nonEmptyString.optional(),
  status: z.enum(selfRepairStatuses).default("pending_immediate_retry"),
  causeLabel: causalLabelSchema.optional(),
  loopIndex: z.number().int().min(1).default(1),
  feedback: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

export const reviewQueueItemContractSchema = z.object({
  studentId: nonEmptyString,
  nodeId: nonEmptyString,
  queueType: nonEmptyString.default("memory_review"),
  status: z.enum(reviewQueueStatuses).default("pending"),
  reasonCode: nonEmptyString.optional(),
  priority: z.number().int().min(0).default(100),
  dueAt: z.date(),
  taskInstanceId: nonEmptyString.optional(),
  attemptId: nonEmptyString.optional(),
  metadata: z.record(z.any()).optional(),
});

export const rewardTraceContractSchema = z
  .object({
    studentId: nonEmptyString,
    decisionLogId: nonEmptyString,
    taskInstanceId: nonEmptyString.optional(),
    attemptId: nonEmptyString.optional(),
    rewardVersion: nonEmptyString,
    rewardWindow: z.enum(rewardWindows).default("same_session"),
    masteryDelta: z.number().default(0),
    transferReward: z.number().default(0),
    retentionReward: z.number().default(0),
    frictionPenalty: z.number().default(0),
    totalReward: z.number(),
    components: z.record(z.any()).optional(),
  })
  .refine(
    (value) =>
      Math.abs(
        value.totalReward -
          (value.masteryDelta + value.transferReward + value.retentionReward - value.frictionPenalty),
      ) < 0.000001,
    {
      message:
        "totalReward must equal masteryDelta + transferReward + retentionReward - frictionPenalty",
    },
  );

export const anchorEvalRunContractSchema = z.object({
  policyVersion: nonEmptyString,
  rewardVersion: nonEmptyString,
  datasetVersion: nonEmptyString,
  status: z.enum(anchorEvalStatuses).default("started"),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  trafficWindowStart: z.date().optional(),
  trafficWindowEnd: z.date().optional(),
  metrics: z.record(z.any()).optional(),
  reportUri: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
});

export const autopilotDelayedOutcomeContractSchema = z.object({
  studentId: nonEmptyString,
  decisionLogId: nonEmptyString.optional(),
  taskInstanceId: nonEmptyString.optional(),
  taskId: nonEmptyString.optional(),
  attemptId: nonEmptyString.optional(),
  outcomeWindow: nonEmptyString.default("same_session"),
  status: nonEmptyString.default("recorded"),
  outcome: z.record(z.any()).optional(),
});

export const autopilotEventLogContractSchema = z
  .object({
    eventType: z.enum(autopilotEventTypes),
    studentId: nonEmptyString.optional(),
    decisionLogId: nonEmptyString.optional(),
    taskInstanceId: nonEmptyString.optional(),
    taskId: nonEmptyString.optional(),
    attemptId: nonEmptyString.optional(),
    evidenceId: nonEmptyString.optional(),
    delayedOutcomeId: nonEmptyString.optional(),
    payload: z.any().optional(),
  })
  .refine(
    (value) => {
      if (!value.evidenceId) return true;
      return Boolean(value.decisionLogId && value.taskId && value.attemptId);
    },
    {
      message: "evidence linkage requires decisionLogId + taskId + attemptId",
      path: ["evidenceId"],
    }
  );

export const anchorEvalSeedRowSchema = z.object({
  id: nonEmptyString,
  policyVersion: nonEmptyString,
  rewardVersion: nonEmptyString,
  datasetVersion: nonEmptyString,
  status: z.enum(anchorEvalStatuses),
  notes: z.string().max(2000),
});

export type CausalDiagnosisContract = z.infer<typeof causalDiagnosisContractSchema>;
export type LearnerTwinSnapshotContract = z.infer<typeof learnerTwinSnapshotContractSchema>;
export type OODTaskSpecContract = z.infer<typeof oodTaskSpecContractSchema>;
export type SelfRepairCycleContract = z.infer<typeof selfRepairCycleContractSchema>;
export type ReviewQueueItemContract = z.infer<typeof reviewQueueItemContractSchema>;
export type RewardTraceContract = z.infer<typeof rewardTraceContractSchema>;
export type AnchorEvalRunContract = z.infer<typeof anchorEvalRunContractSchema>;
export type AutopilotDelayedOutcomeContract = z.infer<typeof autopilotDelayedOutcomeContractSchema>;
export type AutopilotEventLogContract = z.infer<typeof autopilotEventLogContractSchema>;
export type AnchorEvalSeedRow = z.infer<typeof anchorEvalSeedRowSchema>;
