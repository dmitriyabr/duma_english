import { normalizeCausalLabel, type CausalCoreLabel } from "@/lib/db/types";
import {
  mapTaskTypeToActionFamily,
  type CausalSnapshot,
  type PlannerActionFamily,
} from "./ambiguityTrigger";

export const CAUSAL_REMEDIATION_POLICY_VERSION = "cause-remediation-v1" as const;

const DEFAULT_MAX_ABS_ADJUSTMENT = 0.9;
const POSITIVE_ALIGNMENT_THRESHOLD = 0.14;
const NEGATIVE_ALIGNMENT_THRESHOLD = -0.1;

type CauseWeight = {
  label: CausalCoreLabel;
  p: number;
};

export type CausalRemediationAlignment = "preferred" | "discouraged" | "neutral";

export type CausalRemediationAdjustment = {
  taskType: string;
  actionFamily: PlannerActionFamily;
  adjustment: number;
  alignment: CausalRemediationAlignment;
};

export type CausalRemediationTrace = {
  evaluated: boolean;
  policyVersion: string;
  attemptId: string | null;
  modelVersion: string | null;
  entropy: number | null;
  topMargin: number | null;
  confidenceScale: number;
  topCauseLabel: CausalCoreLabel | null;
  topCauseProbability: number | null;
  causeWeights: CauseWeight[];
  actionFamilyScores: Array<{
    actionFamily: PlannerActionFamily;
    score: number;
  }>;
  recommendedActionFamilies: PlannerActionFamily[];
  discouragedActionFamilies: PlannerActionFamily[];
  reasonCodes: string[];
};

export type CausalRemediationPolicyResult = {
  trace: CausalRemediationTrace;
  adjustments: CausalRemediationAdjustment[];
};

const causeActionMatrix: Record<CausalCoreLabel, Record<PlannerActionFamily, number>> = {
  rule_confusion: {
    diagnostic_probe: 0.24,
    targeted_practice: 0.82,
    transfer_probe: -0.32,
  },
  l1_interference: {
    diagnostic_probe: -0.18,
    targeted_practice: 0.18,
    transfer_probe: 0.76,
  },
  retrieval_failure: {
    diagnostic_probe: 0.2,
    targeted_practice: 0.78,
    transfer_probe: -0.22,
  },
  instruction_misread: {
    diagnostic_probe: 0.86,
    targeted_practice: 0.12,
    transfer_probe: -0.34,
  },
  attention_loss: {
    diagnostic_probe: 0.74,
    targeted_practice: 0.14,
    transfer_probe: -0.38,
  },
  production_constraint: {
    diagnostic_probe: 0.69,
    targeted_practice: 0.1,
    transfer_probe: -0.3,
  },
  mixed: {
    diagnostic_probe: 0.42,
    targeted_practice: 0.18,
    transfer_probe: 0.02,
  },
  unknown: {
    diagnostic_probe: 0.24,
    targeted_practice: 0.08,
    transfer_probe: -0.06,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function toFiniteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCauseWeights(snapshot: CausalSnapshot | null): {
  weights: CauseWeight[];
  reasonCodes: string[];
} {
  const reasonCodes: string[] = [];
  if (!snapshot) {
    return { weights: [], reasonCodes: ["no_causal_snapshot"] };
  }

  const acc = new Map<CausalCoreLabel, number>();
  if (Array.isArray(snapshot.distributionJson)) {
    for (const item of snapshot.distributionJson) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const p = toFiniteOrNull(row.p);
      if (p === null || p < 0) continue;
      const label = normalizeCausalLabel(typeof row.label === "string" ? row.label : "unknown");
      acc.set(label, (acc.get(label) || 0) + p);
    }
  }

  let weights = Array.from(acc.entries())
    .map(([label, p]) => ({ label, p }))
    .filter((row) => row.p > 0);

  if (weights.length === 0) {
    const topLabel = normalizeCausalLabel(snapshot.topLabel || "unknown");
    weights = [{ label: topLabel, p: 1 }];
    reasonCodes.push("distribution_unavailable_fallback_top_label");
  }

  const total = weights.reduce((sum, row) => sum + row.p, 0);
  if (total <= 0) {
    reasonCodes.push("distribution_total_non_positive");
    return {
      weights: [{ label: "unknown", p: 1 }],
      reasonCodes,
    };
  }

  weights = weights
    .map((row) => ({
      label: row.label,
      p: row.p / total,
    }))
    .sort((left, right) => right.p - left.p);

  return { weights, reasonCodes };
}

function computeConfidenceScale(snapshot: CausalSnapshot | null) {
  if (!snapshot) return 0;
  const entropy = toFiniteOrNull(snapshot.entropy);
  const topMargin = toFiniteOrNull(snapshot.topMargin);

  const entropyFactor =
    entropy === null
      ? 0.72
      : clamp(1 - clamp(entropy, 0, 1) * 0.75, 0.35, 1);
  const marginFactor =
    topMargin === null ? 0.72 : clamp(0.45 + clamp(topMargin, 0, 1), 0.45, 1);

  return round(clamp((entropyFactor + marginFactor) / 2, 0.35, 1));
}

function alignmentFromAdjustment(adjustment: number): CausalRemediationAlignment {
  if (adjustment >= POSITIVE_ALIGNMENT_THRESHOLD) return "preferred";
  if (adjustment <= NEGATIVE_ALIGNMENT_THRESHOLD) return "discouraged";
  return "neutral";
}

function scoreActionFamilies(weights: CauseWeight[]) {
  const scores: Record<PlannerActionFamily, number> = {
    diagnostic_probe: 0,
    targeted_practice: 0,
    transfer_probe: 0,
  };
  for (const weight of weights) {
    const matrix = causeActionMatrix[weight.label];
    scores.diagnostic_probe += weight.p * matrix.diagnostic_probe;
    scores.targeted_practice += weight.p * matrix.targeted_practice;
    scores.transfer_probe += weight.p * matrix.transfer_probe;
  }
  return {
    diagnostic_probe: round(scores.diagnostic_probe),
    targeted_practice: round(scores.targeted_practice),
    transfer_probe: round(scores.transfer_probe),
  };
}

export function evaluateCausalRemediationPolicy(params: {
  taskTypes: string[];
  causalSnapshot?: CausalSnapshot | null;
  maxAbsAdjustment?: number;
}): CausalRemediationPolicyResult {
  const snapshot = params.causalSnapshot ?? null;
  const { weights, reasonCodes } = parseCauseWeights(snapshot);
  const entropy = toFiniteOrNull(snapshot?.entropy);
  const topMargin = toFiniteOrNull(snapshot?.topMargin);
  const confidenceScale = computeConfidenceScale(snapshot);
  const actionFamilyScores = scoreActionFamilies(weights);
  const maxAbsAdjustment = clamp(
    params.maxAbsAdjustment ?? DEFAULT_MAX_ABS_ADJUSTMENT,
    0,
    2
  );

  const rankedActionFamilies: Array<{
    actionFamily: PlannerActionFamily;
    score: number;
  }> = (Object.keys(actionFamilyScores) as PlannerActionFamily[])
    .map((actionFamily) => ({
      actionFamily,
      score: actionFamilyScores[actionFamily],
    }))
    .sort((left, right) => right.score - left.score);

  if (snapshot && confidenceScale <= 0.55) {
    reasonCodes.push("low_confidence_softened_adjustments");
  }

  const adjustments: CausalRemediationAdjustment[] = params.taskTypes.map((taskType) => {
    const actionFamily = mapTaskTypeToActionFamily(taskType);
    const raw = actionFamilyScores[actionFamily] * confidenceScale;
    const adjustment = round(clamp(raw, -maxAbsAdjustment, maxAbsAdjustment));
    return {
      taskType,
      actionFamily,
      adjustment,
      alignment: alignmentFromAdjustment(adjustment),
    };
  });

  const topCause = weights[0] || null;
  const trace: CausalRemediationTrace = {
    evaluated: Boolean(snapshot),
    policyVersion: CAUSAL_REMEDIATION_POLICY_VERSION,
    attemptId: snapshot?.attemptId || null,
    modelVersion: snapshot?.modelVersion || null,
    entropy,
    topMargin,
    confidenceScale,
    topCauseLabel: topCause?.label || null,
    topCauseProbability: topCause ? round(topCause.p) : null,
    causeWeights: weights,
    actionFamilyScores: rankedActionFamilies.map((row) => ({
      actionFamily: row.actionFamily,
      score: round(row.score),
    })),
    recommendedActionFamilies: rankedActionFamilies
      .filter((row) => row.score > 0.04)
      .map((row) => row.actionFamily),
    discouragedActionFamilies: rankedActionFamilies
      .filter((row) => row.score < -0.04)
      .map((row) => row.actionFamily),
    reasonCodes,
  };

  return {
    trace,
    adjustments,
  };
}
