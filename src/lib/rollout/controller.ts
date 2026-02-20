import { buildShadowPolicyDashboard } from "@/lib/quality/shadowPolicyDashboard";
import { buildRetentionCohortReport } from "@/lib/quality/retentionCohortReport";
import { buildListeningTransferRetentionReport } from "@/lib/quality/listeningTransferRetentionReport";
import {
  type RolloutState,
  type RolloutDecision,
  type RolloutControllerLogEntry,
  ROLLOUT_CONTROLLER_VERSION,
  ROLLOUT_PHASES,
} from "@/lib/contracts/rolloutController";

/** Stop-loss: max high-risk disagreement count per 1k traced decisions. */
const HIGH_RISK_PER_1K_MAX = 10;
/** Stop-loss: min retention overall pass rate (skip if insufficient probes). */
const RETENTION_PASS_RATE_MIN = 0.5;
/** Stop-loss: min transfer pass rate (skip if insufficient evaluable). */
const TRANSFER_PASS_RATE_MIN = 0.4;
/** Min retention evaluated probes to consider retention gate. */
const RETENTION_MIN_SAMPLE = 5;
/** Min transfer evaluable count to consider transfer gate. */
const TRANSFER_MIN_SAMPLE = 3;

export type RolloutEvaluationResult = {
  decision: RolloutDecision;
  reason: string;
  metricsSnapshot: RolloutControllerLogEntry["metricsSnapshot"];
  suggestedPhase?: RolloutState["phase"];
};

/**
 * Evaluates rollout stop-loss from shadow, retention, and transfer metrics.
 * Does not read or write state/log; caller supplies current state and persists result.
 */
export async function evaluateRolloutDecision(params: {
  currentState: RolloutState;
  windowDays?: number;
  now?: Date;
}): Promise<RolloutEvaluationResult> {
  const now = params.now ?? new Date();
  const windowDays = Math.min(14, Math.max(1, params.windowDays ?? 7));
  const { currentState } = params;

  if (currentState.phase === "rolled_back") {
    return {
      decision: "hold",
      reason: "already_rolled_back",
      metricsSnapshot: undefined,
    };
  }

  const [shadow, retention, transfer] = await Promise.all([
    buildShadowPolicyDashboard({ windowDays, now }),
    buildRetentionCohortReport({ windowDays, now }),
    buildListeningTransferRetentionReport({ windowDays, now }),
  ]);

  const traced = shadow.tracedDecisions || 0;
  const highRisk = shadow.safetyCounters?.highRiskDisagreementCount ?? 0;
  const highRiskPer1k = traced >= 100 ? (highRisk / traced) * 1000 : null;

  const retentionPassRate = retention.totalEvaluatedProbeCount >= RETENTION_MIN_SAMPLE
    ? retention.overallPassRate ?? null
    : null;
  const transferPassRate =
    (transfer.transfer?.evaluableCount ?? 0) >= TRANSFER_MIN_SAMPLE
      ? transfer.transfer?.passRate ?? null
      : null;

  const metricsSnapshot: RolloutControllerLogEntry["metricsSnapshot"] = {
    shadowHighRiskPer1k: highRiskPer1k ?? null,
    retentionPassRate,
    transferPassRate,
    retentionSampleSize: retention.totalEvaluatedProbeCount,
    transferSampleSize: transfer.transfer?.evaluableCount ?? 0,
  };

  if (highRiskPer1k !== null && highRiskPer1k > HIGH_RISK_PER_1K_MAX) {
    return {
      decision: "rollback",
      reason: `shadow_high_risk_per_1k=${Number(highRiskPer1k.toFixed(2))}>${HIGH_RISK_PER_1K_MAX}`,
      metricsSnapshot,
      suggestedPhase: "rolled_back",
    };
  }
  if (retentionPassRate !== null && retentionPassRate < RETENTION_PASS_RATE_MIN) {
    return {
      decision: "rollback",
      reason: `retention_pass_rate=${Number(retentionPassRate.toFixed(4))}<${RETENTION_PASS_RATE_MIN}`,
      metricsSnapshot,
      suggestedPhase: "rolled_back",
    };
  }
  if (transferPassRate !== null && transferPassRate < TRANSFER_PASS_RATE_MIN) {
    return {
      decision: "rollback",
      reason: `transfer_pass_rate=${Number(transferPassRate.toFixed(4))}<${TRANSFER_PASS_RATE_MIN}`,
      metricsSnapshot,
      suggestedPhase: "rolled_back",
    };
  }

  const phaseIndex = ROLLOUT_PHASES.indexOf(currentState.phase);
  const nextPhase =
    phaseIndex >= 0 && phaseIndex < ROLLOUT_PHASES.length - 2
      ? ROLLOUT_PHASES[phaseIndex + 1]
      : currentState.phase;
  const canRampUp = nextPhase !== currentState.phase && nextPhase !== "rolled_back";

  if (canRampUp) {
    return {
      decision: "ramp_up",
      reason: `stop_loss_ok_suggest_${nextPhase}`,
      metricsSnapshot,
      suggestedPhase: nextPhase,
    };
  }

  return {
    decision: "hold",
    reason: "stop_loss_ok_hold",
    metricsSnapshot,
  };
}

export function createRolloutLogEntry(params: {
  decision: RolloutEvaluationResult["decision"];
  reason: string;
  currentState: RolloutState;
  metricsSnapshot?: RolloutEvaluationResult["metricsSnapshot"];
  now?: Date;
}): RolloutControllerLogEntry {
  const now = params.now ?? new Date();
  return {
    timestamp: now.toISOString(),
    contractVersion: ROLLOUT_CONTROLLER_VERSION,
    policyVersion: params.currentState.policyVersion,
    phase: params.currentState.phase,
    decision: params.decision,
    reason: params.reason,
    metricsSnapshot: params.metricsSnapshot,
  };
}
