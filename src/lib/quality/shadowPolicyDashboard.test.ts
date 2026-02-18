import assert from "node:assert/strict";
import test from "node:test";
import { __internal } from "./shadowPolicyDashboard";

const baseTrace = {
  modelVersion: "shadow-linear-contextual-v1",
  generatedAt: "2026-02-18T00:00:00.000Z",
  trainingWindowDays: 30,
  trainingSampleSize: 10,
  priorGlobalMean: 0.2,
  priorByTaskType: [
    {
      taskType: "qa_prompt",
      count: 6,
      meanReward: 0.2,
      shrinkedReward: 0.21,
    },
  ],
  rulesChosenTaskType: "qa_prompt",
  shadowChosenTaskType: "role_play",
  shadowChosenTaskTypeAfterSafety: "qa_prompt",
  disagreement: true,
  disagreementAfterSafety: false,
  valueGapVsRules: 0.22,
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

test("shadow policy dashboard aggregates disagreement and safety counters", () => {
  const dashboard = __internal.summarizeShadowPolicyRows({
    windowDays: 30,
    now: new Date("2026-02-18T00:00:00Z"),
    rows: [
      {
        chosenTaskType: "qa_prompt",
        utilityJson: { shadowPolicy: baseTrace },
      },
      {
        chosenTaskType: "target_vocab",
        utilityJson: {
          shadowPolicy: {
            ...baseTrace,
            rulesChosenTaskType: "target_vocab",
            shadowChosenTaskType: "target_vocab",
            shadowChosenTaskTypeAfterSafety: "target_vocab",
            disagreement: false,
            disagreementAfterSafety: false,
            blockedBySafetyGuard: false,
            valueGapVsRules: 0,
            safetyGuardReasons: [],
            safetyCounters: {
              highRiskDisagreementCount: 0,
              verificationGuardTrips: 0,
              blockedBySafetyGuardCount: 0,
            },
          },
        },
      },
      {
        chosenTaskType: "read_aloud",
        utilityJson: { notShadow: true },
      },
    ],
  });

  assert.equal(dashboard.totalDecisions, 3);
  assert.equal(dashboard.tracedDecisions, 2);
  assert.equal(dashboard.disagreementRate, 0.5);
  assert.equal(dashboard.blockedBySafetyGuardRate, 0.5);
  assert.equal(dashboard.safetyCounters.verificationGuardTrips, 1);
  assert.equal(dashboard.disagreementsByTaskType[0]?.taskType, "qa_prompt");
});
