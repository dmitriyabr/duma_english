export const FAST_LANE_PROTOCOL_VERSION = "fast-lane-progression-v1" as const;

export const FAST_LANE_MIN_PROJECTION_CONFIDENCE = 0.8;
export const FAST_LANE_MIN_PLACEMENT_CONFIDENCE = 0.75;
export const FAST_LANE_MAX_PLACEMENT_UNCERTAINTY = 0.24;
export const FAST_LANE_OOD_RATE_DELTA = -0.02;

export type FastLaneSignals = {
  projectionConfidence: number;
  placementConfidence: number;
  placementUncertainty: number;
  promotionReady: boolean;
  stressGateRequired: boolean;
  targetStageCoverage70?: number | null;
  coldStartActive: boolean;
  placementFresh: boolean;
};

export type FastLaneDecision = {
  protocolVersion: typeof FAST_LANE_PROTOCOL_VERSION;
  highConfidence: boolean;
  betweenMilestoneGates: boolean;
  warmupComplete: boolean;
  eligible: boolean;
  reduceDiagnosticDensity: boolean;
  oodBudgetRateDelta: number;
  reasons: string[];
  thresholds: {
    minProjectionConfidence: number;
    minPlacementConfidence: number;
    maxPlacementUncertainty: number;
  };
};

function asFinite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export function evaluateFastLaneDecision(signals: FastLaneSignals): FastLaneDecision {
  const projectionConfidence = clamp(asFinite(signals.projectionConfidence, 0), 0, 1);
  const placementConfidence = clamp(asFinite(signals.placementConfidence, 0), 0, 1);
  const placementUncertainty = clamp(asFinite(signals.placementUncertainty, 1), 0, 1);
  const targetStageCoverage70 = signals.targetStageCoverage70 ?? null;

  const highConfidence =
    projectionConfidence >= FAST_LANE_MIN_PROJECTION_CONFIDENCE &&
    placementConfidence >= FAST_LANE_MIN_PLACEMENT_CONFIDENCE &&
    placementUncertainty <= FAST_LANE_MAX_PLACEMENT_UNCERTAINTY;

  const betweenMilestoneGates =
    !signals.promotionReady &&
    !signals.stressGateRequired &&
    (targetStageCoverage70 === null || targetStageCoverage70 < 0.95);

  const warmupComplete = !signals.coldStartActive && !signals.placementFresh;
  const eligible = highConfidence && betweenMilestoneGates && warmupComplete;

  const reasons: string[] = [];
  reasons.push(highConfidence ? "high_confidence" : "confidence_below_threshold");
  reasons.push(betweenMilestoneGates ? "between_milestone_gates" : "milestone_gate_window");
  reasons.push(warmupComplete ? "warmup_complete" : "warmup_active");

  return {
    protocolVersion: FAST_LANE_PROTOCOL_VERSION,
    highConfidence,
    betweenMilestoneGates,
    warmupComplete,
    eligible,
    reduceDiagnosticDensity: eligible,
    oodBudgetRateDelta: eligible ? FAST_LANE_OOD_RATE_DELTA : 0,
    reasons,
    thresholds: {
      minProjectionConfidence: FAST_LANE_MIN_PROJECTION_CONFIDENCE,
      minPlacementConfidence: FAST_LANE_MIN_PLACEMENT_CONFIDENCE,
      maxPlacementUncertainty: FAST_LANE_MAX_PLACEMENT_UNCERTAINTY,
    },
  };
}

export function applyFastLaneToDiagnosticMode(baseDiagnosticMode: boolean, decision: FastLaneDecision) {
  if (!decision.eligible || !decision.reduceDiagnosticDensity) {
    return baseDiagnosticMode;
  }
  return false;
}

export function applyFastLaneOodRate(baseRate: number, decision: FastLaneDecision) {
  if (!Number.isFinite(baseRate)) return baseRate;
  if (!decision.eligible) return round(baseRate, 4);
  return round(clamp(baseRate + decision.oodBudgetRateDelta, 0, 1), 4);
}
