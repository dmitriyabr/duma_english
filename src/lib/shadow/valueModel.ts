import { prisma } from "@/lib/db";
import { REWARD_FUNCTION_VERSION_V1 } from "@/lib/reward/function";
import {
  SHADOW_POLICY_MODEL_VERSION,
  type ShadowPolicyTrace,
} from "@/lib/contracts/shadowPolicyDashboard";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHADOW_PRIOR_ALPHA = 6;
const SHADOW_PRIOR_CACHE_TTL_MS = 5 * 60 * 1000;

type RewardPriorRow = {
  totalReward: number;
  decisionLog: {
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

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function asFiniteNumber(value: number, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
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

function evaluateShadowDecisionFromPriors(params: {
  candidates: ShadowValueCandidateInput[];
  rulesChosenTaskType: string;
  priors: ShadowRewardPriorSnapshot;
  requiresVerificationCoverage: boolean;
  now: Date;
}): ShadowPolicyTrace {
  const candidateScores: ShadowValueCandidateScore[] = params.candidates.map((candidate) => {
    const priorReward =
      typeof params.priors.priorByTaskType[candidate.taskType] === "number"
        ? params.priors.priorByTaskType[candidate.taskType]
        : params.priors.globalMean;

    const featureContribution =
      candidate.expectedGain * 0.055 +
      (candidate.successProbability - 0.5) * 1.1 +
      candidate.verificationGain * 0.45 +
      candidate.explorationBonus * 0.25 +
      candidate.causalRemediationAdjustment * 0.7 -
      candidate.engagementRisk * 1.2 -
      candidate.latencyRisk * 0.8;

    const safetyFlags: string[] = [];
    if (candidate.engagementRisk > 0.22) safetyFlags.push("high_engagement_risk");
    if (candidate.latencyRisk > 0.2) safetyFlags.push("high_latency_risk");
    if (candidate.successProbability < 0.35) safetyFlags.push("low_success_probability");
    if (params.requiresVerificationCoverage && candidate.verificationGain <= 0) {
      safetyFlags.push("verification_guard_miss");
    }

    return {
      taskType: candidate.taskType,
      shadowValue: round(priorReward + featureContribution),
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
    modelVersion: SHADOW_POLICY_MODEL_VERSION,
    generatedAt: params.now.toISOString(),
    trainingWindowDays: params.priors.windowDays,
    trainingSampleSize: params.priors.sampleSize,
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
  const priors = await loadShadowRewardPriors({
    windowDays: params.priorWindowDays,
    limit: params.priorLimit,
    now,
  });

  return evaluateShadowDecisionFromPriors({
    candidates: params.candidates,
    rulesChosenTaskType: params.rulesChosenTaskType,
    priors,
    requiresVerificationCoverage: params.requiresVerificationCoverage,
    now,
  });
}

export const __internal = {
  summarizeRewardPriors,
  evaluateShadowDecisionFromPriors,
};
