import { buildOffPolicyEvaluationReport } from "@/lib/ope/offPolicyEvaluation";
import { buildReplayDatasetCompletenessArtifact } from "@/lib/quality/replayDatasetCompleteness";
import { buildShadowPolicyDashboard } from "@/lib/quality/shadowPolicyDashboard";

export const POLICY_READINESS_GATE_VERSION = "policy-readiness-gate-v1" as const;

export type PolicyReadinessGate = {
  version: typeof POLICY_READINESS_GATE_VERSION;
  generatedAt: string;
  passed: boolean;
  blockerReasons: string[];
  checks: {
    ope: {
      passed: boolean;
      ciLower: number | null;
    };
    replay: {
      passed: boolean;
      completeRate: number;
      completeRows: number;
    };
    shadow: {
      passed: boolean;
      highRiskPer1k: number | null;
      tracedDecisions: number;
    };
  };
};

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export async function evaluatePolicyReadinessGate(params?: {
  windowDays?: number;
}): Promise<PolicyReadinessGate> {
  const windowDays = Math.max(30, Math.min(180, Math.floor(params?.windowDays ?? 90)));
  const [ope, replayArtifact, shadow] = await Promise.all([
    buildOffPolicyEvaluationReport({
      windowDays,
      limit: 25000,
      bootstrapSamples: 400,
    }),
    buildReplayDatasetCompletenessArtifact({
      windowDays,
      decisionLimit: 30000,
      eventLimit: 120000,
      sampleLimit: 10,
    }),
    buildShadowPolicyDashboard({
      windowDays,
      limit: 25000,
    }),
  ]);

  const ciLower = typeof ope.metrics.ciLower === "number" ? ope.metrics.ciLower : null;
  const opePassed = ciLower !== null && ciLower >= 0;

  const completeRate = replayArtifact.report.summary.completenessRate;
  const completeRows = replayArtifact.report.summary.completeRows;
  const replayPassed = completeRate >= 0.95 && completeRows >= 2000;

  const tracedDecisions = shadow.tracedDecisions;
  const highRiskPer1k =
    tracedDecisions > 0
      ? round((shadow.safetyCounters.highRiskDisagreementCount / tracedDecisions) * 1000)
      : null;
  const shadowPassed =
    tracedDecisions >= 1000 &&
    highRiskPer1k !== null &&
    highRiskPer1k <= 10;

  const blockerReasons: string[] = [];
  if (!opePassed) blockerReasons.push("ope_ci_lower_below_zero_or_missing");
  if (!replayPassed) blockerReasons.push("replay_completeness_or_rows_below_threshold");
  if (!shadowPassed) blockerReasons.push("shadow_safety_or_trace_volume_below_threshold");

  return {
    version: POLICY_READINESS_GATE_VERSION,
    generatedAt: new Date().toISOString(),
    passed: blockerReasons.length === 0,
    blockerReasons,
    checks: {
      ope: {
        passed: opePassed,
        ciLower,
      },
      replay: {
        passed: replayPassed,
        completeRate,
        completeRows,
      },
      shadow: {
        passed: shadowPassed,
        highRiskPer1k,
        tracedDecisions,
      },
    },
  };
}

