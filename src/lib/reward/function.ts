import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rewardTraceContractSchema } from "@/lib/db/types";
import type { TransferVerdict } from "@/lib/ood/transferVerdict";

export const REWARD_FUNCTION_VERSION_V1 = "reward-composite-v1" as const;

export const REWARD_CONFIG_REGISTRY = {
  [REWARD_FUNCTION_VERSION_V1]: {
    mastery: {
      scale: 0.12,
      clampMin: -1.5,
      clampMax: 1.5,
    },
    transfer: {
      transfer_pass: 0.9,
      transfer_fail_validated: -0.9,
      inconclusive_control_missing: -0.2,
      inconclusive_missing_ood_score: -0.25,
      none: 0,
    },
    retention: {
      same_session: { pass: 0, fail: 0, none: 0 },
      day_7: { pass: 0.6, fail: -0.6, none: 0 },
      day_30: { pass: 0.9, fail: -0.9, none: 0 },
    },
    friction: {
      recoveryTriggeredPenalty: 0.35,
      lowTaskScoreThreshold: 55,
      lowTaskScorePenalty: 0.25,
      lowConfidenceThreshold: 0.6,
      lowConfidencePenalty: 0.15,
      maxPenalty: 1,
    },
  },
} as const;

export type RewardVersion = keyof typeof REWARD_CONFIG_REGISTRY;
export type RewardWindow = "same_session" | "day_7" | "day_30";
export type RetentionOutcome = "pass" | "fail" | "none";

export type RewardSignalInput = {
  masteryDeltaTotal: number;
  transferVerdict: TransferVerdict | null;
  retentionOutcome?: RetentionOutcome | null;
  taskScore: number | null;
  transcriptConfidence: number | null;
  recoveryTriggered: boolean;
};

export type RewardComputationResult = {
  rewardVersion: RewardVersion;
  rewardWindow: RewardWindow;
  masteryDelta: number;
  transferReward: number;
  retentionReward: number;
  frictionPenalty: number;
  totalReward: number;
  components: Record<string, unknown>;
};

function round(value: number) {
  return Number(value.toFixed(6));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTransferVerdict(verdict: TransferVerdict | null) {
  if (!verdict) return "none" as const;
  return verdict;
}

function normalizeRetentionOutcome(outcome: RetentionOutcome | null | undefined): RetentionOutcome {
  if (outcome === "pass" || outcome === "fail") return outcome;
  return "none";
}

function computeFrictionPenalty(params: {
  taskScore: number | null;
  transcriptConfidence: number | null;
  recoveryTriggered: boolean;
  config: (typeof REWARD_CONFIG_REGISTRY)[RewardVersion]["friction"];
}) {
  const { config } = params;
  let penalty = 0;
  if (params.recoveryTriggered) {
    penalty += config.recoveryTriggeredPenalty;
  }
  if (typeof params.taskScore === "number" && params.taskScore < config.lowTaskScoreThreshold) {
    penalty += config.lowTaskScorePenalty;
  }
  if (
    typeof params.transcriptConfidence === "number" &&
    params.transcriptConfidence < config.lowConfidenceThreshold
  ) {
    penalty += config.lowConfidencePenalty;
  }
  return round(clamp(penalty, 0, config.maxPenalty));
}

export function evaluateCompositeReward(params: {
  rewardVersion?: RewardVersion;
  rewardWindow?: RewardWindow;
  signals: RewardSignalInput;
}): RewardComputationResult {
  const rewardVersion = params.rewardVersion ?? REWARD_FUNCTION_VERSION_V1;
  const rewardWindow = params.rewardWindow ?? "same_session";
  const config = REWARD_CONFIG_REGISTRY[rewardVersion];
  if (!config) {
    throw new Error(`Unknown reward version: ${rewardVersion}`);
  }

  const normalizedTransferVerdict = normalizeTransferVerdict(params.signals.transferVerdict);
  const normalizedRetentionOutcome = normalizeRetentionOutcome(params.signals.retentionOutcome);
  const masteryRaw = params.signals.masteryDeltaTotal * config.mastery.scale;
  const masteryDelta = round(clamp(masteryRaw, config.mastery.clampMin, config.mastery.clampMax));
  const transferReward = round(config.transfer[normalizedTransferVerdict]);
  const retentionReward = round(config.retention[rewardWindow][normalizedRetentionOutcome]);
  const frictionPenalty = computeFrictionPenalty({
    taskScore: params.signals.taskScore,
    transcriptConfidence: params.signals.transcriptConfidence,
    recoveryTriggered: params.signals.recoveryTriggered,
    config: config.friction,
  });
  const totalReward = round(masteryDelta + transferReward + retentionReward - frictionPenalty);

  return {
    rewardVersion,
    rewardWindow,
    masteryDelta,
    transferReward,
    retentionReward,
    frictionPenalty,
    totalReward,
    components: {
      configVersion: rewardVersion,
      signals: {
        masteryDeltaTotal: round(params.signals.masteryDeltaTotal),
        transferVerdict: normalizedTransferVerdict,
        retentionOutcome: normalizedRetentionOutcome,
        taskScore: params.signals.taskScore,
        transcriptConfidence: params.signals.transcriptConfidence,
        recoveryTriggered: params.signals.recoveryTriggered,
      },
      config,
    },
  };
}

export function buildRewardTraceContract(params: {
  studentId: string;
  decisionLogId: string;
  taskInstanceId?: string | null;
  attemptId?: string | null;
  rewardVersion?: RewardVersion;
  rewardWindow?: RewardWindow;
  signals: RewardSignalInput;
}) {
  const evaluated = evaluateCompositeReward({
    rewardVersion: params.rewardVersion,
    rewardWindow: params.rewardWindow,
    signals: params.signals,
  });

  return rewardTraceContractSchema.parse({
    studentId: params.studentId,
    decisionLogId: params.decisionLogId,
    taskInstanceId: params.taskInstanceId ?? undefined,
    attemptId: params.attemptId ?? undefined,
    rewardVersion: evaluated.rewardVersion,
    rewardWindow: evaluated.rewardWindow,
    masteryDelta: evaluated.masteryDelta,
    transferReward: evaluated.transferReward,
    retentionReward: evaluated.retentionReward,
    frictionPenalty: evaluated.frictionPenalty,
    totalReward: evaluated.totalReward,
    components: evaluated.components,
  });
}

export async function upsertSameSessionRewardTrace(params: {
  studentId: string;
  decisionLogId: string;
  taskInstanceId?: string | null;
  attemptId?: string | null;
  signals: RewardSignalInput;
  rewardVersion?: RewardVersion;
  outcomeLinkedAt?: Date;
}) {
  const trace = buildRewardTraceContract({
    studentId: params.studentId,
    decisionLogId: params.decisionLogId,
    taskInstanceId: params.taskInstanceId ?? null,
    attemptId: params.attemptId ?? null,
    rewardWindow: "same_session",
    rewardVersion: params.rewardVersion,
    signals: params.signals,
  });
  const linkedAt = params.outcomeLinkedAt ?? new Date();

  return prisma.rewardTrace.upsert({
    where: {
      decisionLogId_rewardWindow_rewardVersion: {
        decisionLogId: trace.decisionLogId,
        rewardWindow: trace.rewardWindow,
        rewardVersion: trace.rewardVersion,
      },
    },
    update: {
      taskInstanceId: trace.taskInstanceId ?? null,
      attemptId: trace.attemptId ?? null,
      masteryDelta: trace.masteryDelta,
      transferReward: trace.transferReward,
      retentionReward: trace.retentionReward,
      frictionPenalty: trace.frictionPenalty,
      totalReward: trace.totalReward,
      componentsJson: (trace.components ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      outcomeLinkedAt: linkedAt,
    },
    create: {
      studentId: trace.studentId,
      decisionLogId: trace.decisionLogId,
      taskInstanceId: trace.taskInstanceId ?? null,
      attemptId: trace.attemptId ?? null,
      rewardVersion: trace.rewardVersion,
      rewardWindow: trace.rewardWindow,
      masteryDelta: trace.masteryDelta,
      transferReward: trace.transferReward,
      retentionReward: trace.retentionReward,
      frictionPenalty: trace.frictionPenalty,
      totalReward: trace.totalReward,
      componentsJson: (trace.components ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      outcomeLinkedAt: linkedAt,
    },
  });
}
