import { prisma } from "@/lib/db";
import { opeReportSchema, type OpeReport } from "@/lib/contracts/opeReport";

const DAY_MS = 24 * 60 * 60 * 1000;
export const OPE_POLICY_VERSION = "ope-snips-v1" as const;

type RawOpeRow = {
  decisionLogId: string;
  policyVersion: string;
  propensity: number | null;
  candidateActionSet: unknown;
  preActionScores: unknown;
  linkageAttemptId: string | null;
  decisionLog: {
    chosenTaskType: string;
  } | null;
  attempt: {
    status: string;
    completedAt: Date | null;
    taskEvaluationJson: unknown;
  } | null;
};

type CompleteOpeRow = {
  decisionLogId: string;
  policyVersion: string;
  chosenAction: string;
  targetAction: string;
  propensity: number;
  outcome: number;
};

type OpeExclusionReason =
  | "missing_linkage_attempt"
  | "missing_chosen_action"
  | "missing_candidate_action_set"
  | "missing_pre_action_scores"
  | "invalid_propensity"
  | "chosen_action_not_in_candidate_set"
  | "missing_chosen_action_score"
  | "missing_target_action"
  | "missing_attempt_row"
  | "attempt_not_completed"
  | "missing_task_score";

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asScoreMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || key.trim().length === 0) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[key] = raw;
  }
  return out;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseTaskScore(taskEvaluationJson: unknown) {
  const row = asJsonObject(taskEvaluationJson);
  if (typeof row.taskScore !== "number" || !Number.isFinite(row.taskScore)) return null;
  return Math.max(0, Math.min(100, row.taskScore));
}

function chooseTargetAction(candidateActionSet: string[], preActionScores: Record<string, number>) {
  const rows = candidateActionSet
    .map((action) => ({ action, score: preActionScores[action] }))
    .filter((row) => typeof row.score === "number" && Number.isFinite(row.score))
    .sort((a, b) => {
      if (a.score === b.score) return a.action.localeCompare(b.action);
      return b.score - a.score;
    });
  return rows[0]?.action || null;
}

function mean(values: number[]) {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base]!;
  const upper = sorted[Math.min(base + 1, sorted.length - 1)]!;
  return lower + (upper - lower) * rest;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function evaluateSnipsLift(rows: CompleteOpeRow[], bootstrapSamples: number) {
  const outcomes = rows.map((row) => row.outcome);
  const baseline = mean(outcomes);
  if (baseline === null) {
    return {
      baselineValue: null,
      targetPolicyValue: null,
      lift: null,
      ciLower: null,
      ciUpper: null,
      effectiveSampleSize: null,
      targetMatchRate: null,
      validBootstrapSamples: 0,
    };
  }

  let weightedOutcomeSum = 0;
  let weightSum = 0;
  let weightSqSum = 0;
  let targetMatchCount = 0;

  for (const row of rows) {
    const matched = row.chosenAction === row.targetAction;
    if (matched) targetMatchCount += 1;
    const weight = matched ? 1 / row.propensity : 0;
    weightSum += weight;
    weightSqSum += weight * weight;
    weightedOutcomeSum += weight * row.outcome;
  }

  const targetPolicyValue = weightSum > 0 ? weightedOutcomeSum / weightSum : null;
  const lift = targetPolicyValue === null ? null : targetPolicyValue - baseline;
  const effectiveSampleSize =
    weightSum > 0 && weightSqSum > 0 ? (weightSum * weightSum) / weightSqSum : null;
  const targetMatchRate = rows.length > 0 ? targetMatchCount / rows.length : null;

  if (lift === null || rows.length === 0 || bootstrapSamples <= 0) {
    return {
      baselineValue: round(baseline),
      targetPolicyValue: targetPolicyValue === null ? null : round(targetPolicyValue),
      lift: lift === null ? null : round(lift),
      ciLower: null,
      ciUpper: null,
      effectiveSampleSize: effectiveSampleSize === null ? null : round(effectiveSampleSize),
      targetMatchRate: targetMatchRate === null ? null : round(targetMatchRate),
      validBootstrapSamples: 0,
    };
  }

  const rng = mulberry32(20260218);
  const liftSamples: number[] = [];

  for (let i = 0; i < bootstrapSamples; i += 1) {
    const sample: CompleteOpeRow[] = [];
    for (let j = 0; j < rows.length; j += 1) {
      const idx = Math.floor(rng() * rows.length);
      sample.push(rows[idx]!);
    }

    const baselineSample = mean(sample.map((row) => row.outcome));
    if (baselineSample === null) continue;

    let sampleWeightedOutcomeSum = 0;
    let sampleWeightSum = 0;
    for (const row of sample) {
      const matched = row.chosenAction === row.targetAction;
      const weight = matched ? 1 / row.propensity : 0;
      sampleWeightSum += weight;
      sampleWeightedOutcomeSum += weight * row.outcome;
    }
    if (sampleWeightSum <= 0) continue;

    const targetSample = sampleWeightedOutcomeSum / sampleWeightSum;
    liftSamples.push(targetSample - baselineSample);
  }

  const ciLower = quantile(liftSamples, 0.025);
  const ciUpper = quantile(liftSamples, 0.975);

  return {
    baselineValue: round(baseline),
    targetPolicyValue: targetPolicyValue === null ? null : round(targetPolicyValue),
    lift: lift === null ? null : round(lift),
    ciLower: ciLower === null ? null : round(ciLower),
    ciUpper: ciUpper === null ? null : round(ciUpper),
    effectiveSampleSize: effectiveSampleSize === null ? null : round(effectiveSampleSize),
    targetMatchRate: targetMatchRate === null ? null : round(targetMatchRate),
    validBootstrapSamples: liftSamples.length,
  };
}

function summarizeRows(params: {
  rows: RawOpeRow[];
  windowDays: number;
  bootstrapSamples: number;
  now?: Date;
}): OpeReport {
  const now = params.now || new Date();
  const exclusionCounts = new Map<OpeExclusionReason, number>();
  const policyVersionCounts = new Map<string, number>();
  const completeRows: CompleteOpeRow[] = [];

  const markExcluded = (reason: OpeExclusionReason) => {
    exclusionCounts.set(reason, (exclusionCounts.get(reason) || 0) + 1);
  };

  for (const row of params.rows) {
    policyVersionCounts.set(row.policyVersion, (policyVersionCounts.get(row.policyVersion) || 0) + 1);

    if (!row.linkageAttemptId) {
      markExcluded("missing_linkage_attempt");
      continue;
    }

    const chosenAction = row.decisionLog?.chosenTaskType?.trim() || "";
    if (!chosenAction) {
      markExcluded("missing_chosen_action");
      continue;
    }

    const candidateActionSet = asStringArray(row.candidateActionSet);
    if (candidateActionSet.length === 0) {
      markExcluded("missing_candidate_action_set");
      continue;
    }

    const preActionScores = asScoreMap(row.preActionScores);
    if (Object.keys(preActionScores).length === 0) {
      markExcluded("missing_pre_action_scores");
      continue;
    }

    if (typeof row.propensity !== "number" || !Number.isFinite(row.propensity) || row.propensity <= 0 || row.propensity > 1) {
      markExcluded("invalid_propensity");
      continue;
    }

    if (!candidateActionSet.includes(chosenAction)) {
      markExcluded("chosen_action_not_in_candidate_set");
      continue;
    }

    if (typeof preActionScores[chosenAction] !== "number") {
      markExcluded("missing_chosen_action_score");
      continue;
    }

    const targetAction = chooseTargetAction(candidateActionSet, preActionScores);
    if (!targetAction) {
      markExcluded("missing_target_action");
      continue;
    }

    if (!row.attempt) {
      markExcluded("missing_attempt_row");
      continue;
    }

    if (row.attempt.status !== "completed") {
      markExcluded("attempt_not_completed");
      continue;
    }

    const taskScore = parseTaskScore(row.attempt.taskEvaluationJson);
    if (taskScore === null) {
      markExcluded("missing_task_score");
      continue;
    }

    completeRows.push({
      decisionLogId: row.decisionLogId,
      policyVersion: row.policyVersion,
      chosenAction,
      targetAction,
      propensity: row.propensity,
      outcome: taskScore / 100,
    });
  }

  const totalRows = params.rows.length;
  const completeCount = completeRows.length;
  const excludedRows = Math.max(0, totalRows - completeCount);
  const incompleteRate = totalRows > 0 ? excludedRows / totalRows : 0;
  const metrics = evaluateSnipsLift(completeRows, params.bootstrapSamples);

  return opeReportSchema.parse({
    generatedAt: now.toISOString(),
    policyVersion: OPE_POLICY_VERSION,
    windowDays: params.windowDays,
    totalRows,
    completeRows: completeCount,
    excludedRows,
    incompleteRate: round(incompleteRate),
    bootstrapSamples: params.bootstrapSamples,
    validBootstrapSamples: metrics.validBootstrapSamples,
    exclusionReasons: [...exclusionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    policyVersions: [...policyVersionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    metrics: {
      baselineValue: metrics.baselineValue,
      targetPolicyValue: metrics.targetPolicyValue,
      lift: metrics.lift,
      ciLower: metrics.ciLower,
      ciUpper: metrics.ciUpper,
      effectiveSampleSize: metrics.effectiveSampleSize,
      targetMatchRate: metrics.targetMatchRate,
    },
  });
}

export async function buildOffPolicyEvaluationReport(params?: {
  windowDays?: number;
  limit?: number;
  bootstrapSamples?: number;
  now?: Date;
}): Promise<OpeReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 90)));
  const limit = Math.max(10, Math.min(50000, Math.floor(params?.limit ?? 10000)));
  const bootstrapSamples = Math.max(0, Math.min(2000, Math.floor(params?.bootstrapSamples ?? 400)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.policyDecisionLogV2.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      decisionLogId: true,
      policyVersion: true,
      propensity: true,
      candidateActionSet: true,
      preActionScores: true,
      linkageAttemptId: true,
      decisionLog: {
        select: {
          chosenTaskType: true,
        },
      },
      attempt: {
        select: {
          status: true,
          completedAt: true,
          taskEvaluationJson: true,
        },
      },
    },
  });

  return summarizeRows({
    rows,
    windowDays,
    bootstrapSamples,
    now,
  });
}

export const __internal = {
  summarizeRows,
  chooseTargetAction,
  evaluateSnipsLift,
};
