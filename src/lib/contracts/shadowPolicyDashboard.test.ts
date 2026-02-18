import assert from "node:assert/strict";
import test from "node:test";
import {
  extractShadowPolicyTraceFromUtilityJson,
  shadowPolicyDashboardSchema,
  shadowPolicyTraceSchema,
} from "./shadowPolicyDashboard";

const validTrace = {
  modelVersion: "shadow-linear-contextual-v1",
  generatedAt: "2026-02-18T00:00:00.000Z",
  trainingWindowDays: 30,
  trainingSampleSize: 12,
  priorGlobalMean: 0.22,
  priorByTaskType: [
    {
      taskType: "qa_prompt",
      count: 7,
      meanReward: 0.19,
      shrinkedReward: 0.2,
    },
  ],
  rulesChosenTaskType: "qa_prompt",
  shadowChosenTaskType: "role_play",
  shadowChosenTaskTypeAfterSafety: "qa_prompt",
  disagreement: true,
  disagreementAfterSafety: false,
  valueGapVsRules: 0.31,
  blockedBySafetyGuard: true,
  safetyGuardReasons: ["verification_guard_miss"],
  safetyCounters: {
    highRiskDisagreementCount: 1,
    verificationGuardTrips: 1,
    blockedBySafetyGuardCount: 1,
  },
  candidateScores: [
    {
      taskType: "qa_prompt",
      shadowValue: 0.44,
      priorReward: 0.2,
      featureContribution: 0.24,
      safetyFlags: [],
    },
  ],
};

test("shadow trace parser extracts valid trace from utility json", () => {
  const parsed = extractShadowPolicyTraceFromUtilityJson({
    shadowPolicy: validTrace,
  });

  assert.ok(parsed);
  assert.equal(parsed?.modelVersion, "shadow-linear-contextual-v1");
  assert.equal(parsed?.blockedBySafetyGuard, true);
});

test("shadow trace parser returns null on invalid payload", () => {
  const parsed = extractShadowPolicyTraceFromUtilityJson({
    shadowPolicy: {
      ...validTrace,
      trainingWindowDays: 0,
    },
  });

  assert.equal(parsed, null);
});

test("dashboard schema accepts valid aggregate payload", () => {
  const parsed = shadowPolicyDashboardSchema.parse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    windowDays: 30,
    totalDecisions: 10,
    tracedDecisions: 8,
    traceCoverageRate: 0.8,
    disagreementRate: 0.5,
    disagreementAfterSafetyRate: 0.1,
    blockedBySafetyGuardRate: 0.4,
    averageValueGap: 0.18,
    modelVersions: [{ modelVersion: "shadow-linear-contextual-v1", count: 8 }],
    safetyCounters: {
      highRiskDisagreementCount: 2,
      verificationGuardTrips: 3,
      blockedBySafetyGuardCount: 4,
    },
    disagreementsByTaskType: [{ taskType: "qa_prompt", count: 2 }],
  });

  assert.equal(parsed.tracedDecisions, 8);
});

test("trace schema enforces model version", () => {
  const parsed = shadowPolicyTraceSchema.safeParse({
    ...validTrace,
    modelVersion: "shadow-unknown-v0",
  });
  assert.equal(parsed.success, false);
});
