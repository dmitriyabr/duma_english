import { z } from "zod";

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

export const causalDistributionEntrySchema = z.object({
  label: nonEmptyString,
  p: probability,
});

export const causalDiagnosisContractSchema = z.object({
  attemptId: nonEmptyString,
  studentId: nonEmptyString,
  taxonomyVersion: nonEmptyString.default("causal-taxonomy-v1"),
  modelVersion: nonEmptyString,
  topLabel: nonEmptyString,
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
  causeLabel: nonEmptyString.optional(),
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
