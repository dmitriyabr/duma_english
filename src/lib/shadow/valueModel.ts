import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { REWARD_FUNCTION_VERSION_V1 } from "@/lib/reward/function";
import {
  SHADOW_POLICY_MODEL_VERSION,
  type ShadowPolicyTrace,
} from "@/lib/contracts/shadowPolicyDashboard";
import { featureFlags } from "@/lib/featureFlags";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHADOW_PRIOR_ALPHA = 6;
const SHADOW_PRIOR_CACHE_TTL_MS = 5 * 60 * 1000;

type RewardPriorRow = {
  totalReward: number;
  decisionLog: {
    chosenTaskType: string;
  } | null;
};

type RewardTrainRow = {
  totalReward: number;
  decisionLog: {
    utilityJson: unknown;
    chosenTaskType: string;
  } | null;
};

type ShadowRewardPriorSnapshot = {
  generatedAt: string;
  windowDays: number;
  sampleSize: number;
  globalMean: number;
  priorByTaskType: Record<string, number>;
  priorRows: Array<{
    taskType: string;
    count: number;
    meanReward: number;
    shrinkedReward: number;
  }>;
};

type ShadowModelWeights = {
  bias: number;
  priorReward: number;
  expectedGain: number;
  successProbability: number;
  verificationGain: number;
  explorationBonus: number;
  causalRemediationAdjustment: number;
  engagementRisk: number;
  latencyRisk: number;
};

type ShadowModelSnapshot = {
  version: string;
  weights: ShadowModelWeights;
  trainedAt: string;
  sampleSize: number;
};

export type ShadowValueCandidateInput = {
  taskType: string;
  actionFamily: string;
  expectedGain: number;
  successProbability: number;
  engagementRisk: number;
  latencyRisk: number;
  explorationBonus: number;
  verificationGain: number;
  causalRemediationAdjustment: number;
  baseUtility: number;
  utility: number;
};

type ShadowValueCandidateScore = {
  taskType: string;
  shadowValue: number;
  priorReward: number;
  featureContribution: number;
  safetyFlags: string[];
};

let shadowPriorCache:
  | {
      expiresAt: number;
      snapshot: ShadowRewardPriorSnapshot;
    }
  | null = null;

const DEFAULT_SHADOW_MODEL_WEIGHTS: ShadowModelWeights = {
  bias: 0,
  priorReward: 1,
  expectedGain: 0.055,
  successProbability: 1.1,
  verificationGain: 0.45,
  explorationBonus: 0.25,
  causalRemediationAdjustment: 0.7,
  engagementRisk: 1.2,
  latencyRisk: 0.8,
};

const DEFAULT_SHADOW_MODEL_VERSION = `${SHADOW_POLICY_MODEL_VERSION}:default`;
const LEGACY_SHADOW_POLICY_MODEL_VERSION = "shadow-linear-contextual-v1";

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function asFiniteNumber(value: number, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseShadowModelWeights(raw: unknown): ShadowModelWeights | null {
  const input = asObject(raw);
  const parsed: ShadowModelWeights = {
    bias: asFiniteNumber(Number(input.bias), NaN),
    priorReward: asFiniteNumber(Number(input.priorReward), NaN),
    expectedGain: asFiniteNumber(Number(input.expectedGain), NaN),
    successProbability: asFiniteNumber(Number(input.successProbability), NaN),
    verificationGain: asFiniteNumber(Number(input.verificationGain), NaN),
    explorationBonus: asFiniteNumber(Number(input.explorationBonus), NaN),
    causalRemediationAdjustment: asFiniteNumber(
      Number(input.causalRemediationAdjustment),
      NaN,
    ),
    engagementRisk: asFiniteNumber(Number(input.engagementRisk), NaN),
    latencyRisk: asFiniteNumber(Number(input.latencyRisk), NaN),
  };
  const valid = Object.values(parsed).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  return valid ? parsed : null;
}

function defaultShadowModelSnapshot(now: Date): ShadowModelSnapshot {
  return {
    version: DEFAULT_SHADOW_MODEL_VERSION,
    weights: DEFAULT_SHADOW_MODEL_WEIGHTS,
    trainedAt: now.toISOString(),
    sampleSize: 0,
  };
}

function legacyShadowModelSnapshot(now: Date): ShadowModelSnapshot {
  return {
    version: "legacy-rule-weights-v1",
    weights: DEFAULT_SHADOW_MODEL_WEIGHTS,
    trainedAt: now.toISOString(),
    sampleSize: 0,
  };
}

async function loadShadowModelSnapshot(now: Date): Promise<ShadowModelSnapshot> {
  try {
    const active = await prisma.shadowPolicyModelSnapshot.findFirst({
      where: { isActive: true },
      orderBy: { trainedAt: "desc" },
      select: {
        version: true,
        weightsJson: true,
        trainedAt: true,
        sampleSize: true,
      },
    });

    const activeWeights = parseShadowModelWeights(active?.weightsJson);
    if (active && activeWeights) {
      return {
        version: active.version,
        weights: activeWeights,
        trainedAt: active.trainedAt.toISOString(),
        sampleSize: Math.max(0, active.sampleSize),
      };
    }

    const previous = await prisma.shadowPolicyModelSnapshot.findFirst({
      where: active?.version ? { version: { not: active.version } } : {},
      orderBy: { trainedAt: "desc" },
      select: {
        version: true,
        weightsJson: true,
        trainedAt: true,
        sampleSize: true,
      },
    });
    const previousWeights = parseShadowModelWeights(previous?.weightsJson);
    if (previous && previousWeights) {
      return {
        version: previous.version,
        weights: previousWeights,
        trainedAt: previous.trainedAt.toISOString(),
        sampleSize: Math.max(0, previous.sampleSize),
      };
    }

    return await bootstrapActiveShadowModelSnapshot(now);
  } catch {
    return defaultShadowModelSnapshot(now);
  }
}

function summarizeRewardPriors(params: {
  rows: RewardPriorRow[];
  windowDays: number;
  now: Date;
  alpha?: number;
}): ShadowRewardPriorSnapshot {
  const alpha = Math.max(1, asFiniteNumber(params.alpha ?? SHADOW_PRIOR_ALPHA, SHADOW_PRIOR_ALPHA));
  const byTaskType = new Map<string, { sum: number; count: number }>();

  let globalSum = 0;
  let sampleSize = 0;

  for (const row of params.rows) {
    const reward = asFiniteNumber(row.totalReward, 0);
    const taskType = row.decisionLog?.chosenTaskType?.trim();
    if (!taskType) continue;

    globalSum += reward;
    sampleSize += 1;

    const current = byTaskType.get(taskType) || { sum: 0, count: 0 };
    current.sum += reward;
    current.count += 1;
    byTaskType.set(taskType, current);
  }

  const globalMean = sampleSize > 0 ? globalSum / sampleSize : 0;
  const priorRows = [...byTaskType.entries()]
    .map(([taskType, row]) => {
      const meanReward = row.count > 0 ? row.sum / row.count : globalMean;
      const shrinkedReward = (meanReward * row.count + globalMean * alpha) / (row.count + alpha);
      return {
        taskType,
        count: row.count,
        meanReward: round(meanReward),
        shrinkedReward: round(shrinkedReward),
      };
    })
    .sort((a, b) => {
      if (a.shrinkedReward === b.shrinkedReward) return a.taskType.localeCompare(b.taskType);
      return b.shrinkedReward - a.shrinkedReward;
    });

  const priorByTaskType: Record<string, number> = {};
  for (const row of priorRows) {
    priorByTaskType[row.taskType] = row.shrinkedReward;
  }

  return {
    generatedAt: params.now.toISOString(),
    windowDays: params.windowDays,
    sampleSize,
    globalMean: round(globalMean),
    priorByTaskType,
    priorRows,
  };
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
}

function covariance(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftAvg = mean(left);
  const rightAvg = mean(right);
  let total = 0;
  for (let i = 0; i < left.length; i += 1) {
    total += (left[i] - leftAvg) * (right[i] - rightAvg);
  }
  return total / left.length;
}

function clampWeight(value: number, min = 0, max = 3) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function learnShadowModelWeights(rows: RewardTrainRow[]): {
  weights: ShadowModelWeights;
  sampleSize: number;
} {
  const featureRows: Array<{
    expectedGain: number;
    successProbability: number;
    verificationGain: number;
    explorationBonus: number;
    causalRemediationAdjustment: number;
    engagementRisk: number;
    latencyRisk: number;
    reward: number;
  }> = [];

  for (const row of rows) {
    const utility = asObject(row.decisionLog?.utilityJson);
    featureRows.push({
      expectedGain: asFiniteNumber(Number(utility.expectedGain), 0),
      successProbability: asFiniteNumber(Number(utility.successProbability), 0),
      verificationGain: asFiniteNumber(Number(utility.verificationGain), 0),
      explorationBonus: asFiniteNumber(Number(utility.explorationBonus), 0),
      causalRemediationAdjustment: asFiniteNumber(
        Number(asObject(utility.causalRemediation).chosenAdjustment),
        0,
      ),
      engagementRisk: asFiniteNumber(Number(utility.engagementRisk), 0),
      latencyRisk: asFiniteNumber(Number(utility.latencyRisk), 0),
      reward: asFiniteNumber(row.totalReward, 0),
    });
  }

  if (featureRows.length < 120) {
    return {
      weights: DEFAULT_SHADOW_MODEL_WEIGHTS,
      sampleSize: featureRows.length,
    };
  }

  const rewards = featureRows.map((row) => row.reward);
  const slope = (values: number[]) => {
    const v = variance(values);
    if (v <= 1e-9) return 0;
    return covariance(values, rewards) / v;
  };

  const expectedGainSlope = slope(featureRows.map((row) => row.expectedGain));
  const successSlope = slope(featureRows.map((row) => row.successProbability));
  const verificationSlope = slope(featureRows.map((row) => row.verificationGain));
  const explorationSlope = slope(featureRows.map((row) => row.explorationBonus));
  const causalSlope = slope(featureRows.map((row) => row.causalRemediationAdjustment));
  const engagementSlope = slope(featureRows.map((row) => row.engagementRisk));
  const latencySlope = slope(featureRows.map((row) => row.latencyRisk));

  return {
    weights: {
      bias: round(mean(rewards), 6),
      priorReward: 1,
      expectedGain: clampWeight(expectedGainSlope),
      successProbability: clampWeight(successSlope),
      verificationGain: clampWeight(verificationSlope),
      explorationBonus: clampWeight(explorationSlope),
      causalRemediationAdjustment: clampWeight(causalSlope),
      engagementRisk: clampWeight(-engagementSlope),
      latencyRisk: clampWeight(-latencySlope),
    },
    sampleSize: featureRows.length,
  };
}

async function bootstrapActiveShadowModelSnapshot(now: Date): Promise<ShadowModelSnapshot> {
  const since = new Date(now.getTime() - 90 * DAY_MS);
  const rows = await prisma.rewardTrace.findMany({
    where: {
      rewardWindow: "same_session",
      rewardVersion: REWARD_FUNCTION_VERSION_V1,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      totalReward: true,
      decisionLog: {
        select: {
          chosenTaskType: true,
          utilityJson: true,
        },
      },
    },
  });
  const learned = learnShadowModelWeights(rows as RewardTrainRow[]);
  const version = `auto-${now.toISOString().replace(/[:.]/g, "-")}`;
  await upsertShadowModelSnapshot({
    version,
    weights: learned.weights,
    trainedAt: now,
    sampleSize: learned.sampleSize,
    activate: true,
  });
  return {
    version,
    weights: learned.weights,
    trainedAt: now.toISOString(),
    sampleSize: learned.sampleSize,
  };
}

function evaluateShadowDecisionFromPriors(params: {
  candidates: ShadowValueCandidateInput[];
  rulesChosenTaskType: string;
  priors: ShadowRewardPriorSnapshot;
  modelSnapshot: ShadowModelSnapshot;
  requiresVerificationCoverage: boolean;
  now: Date;
  modelVersionTag?: string;
}): ShadowPolicyTrace {
  const w = params.modelSnapshot.weights;
  const candidateScores: ShadowValueCandidateScore[] = params.candidates.map((candidate) => {
    const priorReward =
      typeof params.priors.priorByTaskType[candidate.taskType] === "number"
        ? params.priors.priorByTaskType[candidate.taskType]
        : params.priors.globalMean;

    const featureContribution =
      w.bias +
      priorReward * w.priorReward +
      candidate.expectedGain * w.expectedGain +
      (candidate.successProbability - 0.5) * w.successProbability +
      candidate.verificationGain * w.verificationGain +
      candidate.explorationBonus * w.explorationBonus +
      candidate.causalRemediationAdjustment * w.causalRemediationAdjustment -
      candidate.engagementRisk * w.engagementRisk -
      candidate.latencyRisk * w.latencyRisk;

    const safetyFlags: string[] = [];
    if (candidate.engagementRisk > 0.22) safetyFlags.push("high_engagement_risk");
    if (candidate.latencyRisk > 0.2) safetyFlags.push("high_latency_risk");
    if (candidate.successProbability < 0.35) safetyFlags.push("low_success_probability");
    if (params.requiresVerificationCoverage && candidate.verificationGain <= 0) {
      safetyFlags.push("verification_guard_miss");
    }

    return {
      taskType: candidate.taskType,
      shadowValue: round(featureContribution),
      priorReward: round(priorReward),
      featureContribution: round(featureContribution),
      safetyFlags,
    };
  });

  candidateScores.sort((a, b) => {
    if (a.shadowValue === b.shadowValue) return a.taskType.localeCompare(b.taskType);
    return b.shadowValue - a.shadowValue;
  });

  const rulesChosenTaskType = params.rulesChosenTaskType;
  const shadowTop = candidateScores[0] || null;
  const rulesCandidate =
    candidateScores.find((candidate) => candidate.taskType === rulesChosenTaskType) || null;
  const blockedBySafetyGuard = Boolean(shadowTop && shadowTop.safetyFlags.length > 0);
  const shadowChosenTaskType = shadowTop?.taskType || null;
  const shadowChosenTaskTypeAfterSafety = blockedBySafetyGuard
    ? rulesChosenTaskType
    : shadowChosenTaskType;
  const disagreement = Boolean(shadowChosenTaskType && shadowChosenTaskType !== rulesChosenTaskType);
  const disagreementAfterSafety = Boolean(
    shadowChosenTaskTypeAfterSafety && shadowChosenTaskTypeAfterSafety !== rulesChosenTaskType
  );
  const valueGapVsRules =
    shadowTop && rulesCandidate ? round(shadowTop.shadowValue - rulesCandidate.shadowValue) : null;

  const safetyGuardReasons = shadowTop?.safetyFlags || [];
  const safetyCounters = {
    highRiskDisagreementCount: disagreement && blockedBySafetyGuard ? 1 : 0,
    verificationGuardTrips: safetyGuardReasons.includes("verification_guard_miss") ? 1 : 0,
    blockedBySafetyGuardCount: blockedBySafetyGuard ? 1 : 0,
  };

  return {
    modelVersion: `${params.modelVersionTag || SHADOW_POLICY_MODEL_VERSION}:${params.modelSnapshot.version}`,
    modelSnapshotVersion: params.modelSnapshot.version,
    modelTrainedAt: params.modelSnapshot.trainedAt,
    generatedAt: params.now.toISOString(),
    trainingWindowDays: params.priors.windowDays,
    trainingSampleSize: params.modelSnapshot.sampleSize,
    priorGlobalMean: round(params.priors.globalMean),
    priorByTaskType: params.priors.priorRows,
    rulesChosenTaskType,
    shadowChosenTaskType,
    shadowChosenTaskTypeAfterSafety,
    disagreement,
    disagreementAfterSafety,
    valueGapVsRules,
    blockedBySafetyGuard,
    safetyGuardReasons,
    safetyCounters,
    candidateScores,
  };
}

async function loadShadowRewardPriors(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
  disableCache?: boolean;
}): Promise<ShadowRewardPriorSnapshot> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(90, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(50, Math.min(5000, Math.floor(params?.limit ?? 800)));
  const cacheKeyAllowed = !params?.disableCache;

  if (cacheKeyAllowed && shadowPriorCache && shadowPriorCache.expiresAt > now.getTime()) {
    return shadowPriorCache.snapshot;
  }

  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const rows = await prisma.rewardTrace.findMany({
    where: {
      rewardWindow: "same_session",
      rewardVersion: REWARD_FUNCTION_VERSION_V1,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      totalReward: true,
      decisionLog: {
        select: {
          chosenTaskType: true,
        },
      },
    },
  });

  const snapshot = summarizeRewardPriors({
    rows,
    windowDays,
    now,
    alpha: SHADOW_PRIOR_ALPHA,
  });

  if (cacheKeyAllowed) {
    shadowPriorCache = {
      expiresAt: now.getTime() + SHADOW_PRIOR_CACHE_TTL_MS,
      snapshot,
    };
  }

  return snapshot;
}

export async function evaluateShadowValueDecision(params: {
  candidates: ShadowValueCandidateInput[];
  rulesChosenTaskType: string;
  requiresVerificationCoverage: boolean;
  priorWindowDays?: number;
  priorLimit?: number;
  now?: Date;
}): Promise<ShadowPolicyTrace> {
  const now = params.now || new Date();
  const shadowModelV2Enabled = featureFlags.shadowModelV2;
  const modelVersionTag = shadowModelV2Enabled
    ? SHADOW_POLICY_MODEL_VERSION
    : LEGACY_SHADOW_POLICY_MODEL_VERSION;
  const [priors, modelSnapshot] = await Promise.all([
    loadShadowRewardPriors({
      windowDays: params.priorWindowDays,
      limit: params.priorLimit,
      now,
    }),
    shadowModelV2Enabled ? loadShadowModelSnapshot(now) : Promise.resolve(legacyShadowModelSnapshot(now)),
  ]);

  return evaluateShadowDecisionFromPriors({
    candidates: params.candidates,
    rulesChosenTaskType: params.rulesChosenTaskType,
    priors,
    modelSnapshot,
    requiresVerificationCoverage: params.requiresVerificationCoverage,
    now,
    modelVersionTag,
  });
}

export async function upsertShadowModelSnapshot(params: {
  version: string;
  weights: ShadowModelWeights;
  trainedAt?: Date;
  sampleSize: number;
  activate?: boolean;
}) {
  const version = params.version.trim();
  if (!version) throw new Error("shadow model snapshot version is required");
  const trainedAt = params.trainedAt || new Date();
  const sampleSize = Math.max(0, Math.floor(params.sampleSize));
  const activate = params.activate !== false;

  if (activate) {
    await prisma.shadowPolicyModelSnapshot.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
  }

  return prisma.shadowPolicyModelSnapshot.upsert({
    where: { version },
    update: {
      weightsJson: params.weights as unknown as Prisma.InputJsonValue,
      trainedAt,
      sampleSize,
      isActive: activate,
    },
    create: {
      version,
      weightsJson: params.weights as unknown as Prisma.InputJsonValue,
      trainedAt,
      sampleSize,
      isActive: activate,
    },
  });
}

export async function trainAndActivateShadowModelSnapshot(params?: {
  windowDays?: number;
  now?: Date;
}) {
  const now = params?.now || new Date();
  const windowDays = Math.max(30, Math.min(180, Math.floor(params?.windowDays ?? 90)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const rows = await prisma.rewardTrace.findMany({
    where: {
      rewardWindow: "same_session",
      rewardVersion: REWARD_FUNCTION_VERSION_V1,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      totalReward: true,
      decisionLog: {
        select: {
          chosenTaskType: true,
          utilityJson: true,
        },
      },
    },
  });
  const learned = learnShadowModelWeights(rows as RewardTrainRow[]);
  const version = `trained-${now.toISOString().replace(/[:.]/g, "-")}`;
  await upsertShadowModelSnapshot({
    version,
    weights: learned.weights,
    trainedAt: now,
    sampleSize: learned.sampleSize,
    activate: true,
  });
  return {
    version,
    trainedAt: now.toISOString(),
    sampleSize: learned.sampleSize,
    weights: learned.weights,
  };
}

export const __internal = {
  summarizeRewardPriors,
  evaluateShadowDecisionFromPriors,
  parseShadowModelWeights,
  defaultShadowModelSnapshot,
  learnShadowModelWeights,
};
