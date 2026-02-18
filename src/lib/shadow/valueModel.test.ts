import assert from "node:assert/strict";
import test from "node:test";
import { __internal, type ShadowValueCandidateInput } from "./valueModel";

test("reward priors learn per-task reward means with shrinkage", () => {
  const priors = __internal.summarizeRewardPriors({
    now: new Date("2026-02-18T00:00:00Z"),
    windowDays: 30,
    rows: [
      {
        totalReward: 1.2,
        decisionLog: { chosenTaskType: "role_play" },
      },
      {
        totalReward: 0.9,
        decisionLog: { chosenTaskType: "role_play" },
      },
      {
        totalReward: -0.3,
        decisionLog: { chosenTaskType: "read_aloud" },
      },
    ],
  });

  assert.equal(priors.sampleSize, 3);
  assert.ok(priors.priorByTaskType.role_play > priors.priorByTaskType.read_aloud);
  assert.ok(priors.globalMean > 0);
});

test("shadow scorer can disagree with rules while keeping deterministic ranking", () => {
  const candidates: ShadowValueCandidateInput[] = [
    {
      taskType: "qa_prompt",
      actionFamily: "targeted_practice",
      expectedGain: 3.1,
      successProbability: 0.67,
      engagementRisk: 0.12,
      latencyRisk: 0.1,
      explorationBonus: 0.2,
      verificationGain: 0.55,
      causalRemediationAdjustment: 0,
      baseUtility: 2.4,
      utility: 2.4,
    },
    {
      taskType: "role_play",
      actionFamily: "targeted_practice",
      expectedGain: 2.7,
      successProbability: 0.63,
      engagementRisk: 0.1,
      latencyRisk: 0.1,
      explorationBonus: 0.2,
      verificationGain: 0,
      causalRemediationAdjustment: 0,
      baseUtility: 2.2,
      utility: 2.2,
    },
  ];

  const trace = __internal.evaluateShadowDecisionFromPriors({
    now: new Date("2026-02-18T00:00:00Z"),
    rulesChosenTaskType: "qa_prompt",
    requiresVerificationCoverage: false,
    priors: {
      generatedAt: "2026-02-18T00:00:00Z",
      windowDays: 30,
      sampleSize: 20,
      globalMean: 0.2,
      priorByTaskType: {
        qa_prompt: 0.1,
        role_play: 0.7,
      },
      priorRows: [
        { taskType: "role_play", count: 10, meanReward: 0.8, shrinkedReward: 0.7 },
        { taskType: "qa_prompt", count: 10, meanReward: 0.1, shrinkedReward: 0.1 },
      ],
    },
    candidates,
  });

  assert.equal(trace.shadowChosenTaskType, "role_play");
  assert.equal(trace.disagreement, true);
  assert.equal(trace.modelVersion, "shadow-linear-contextual-v1");
});

test("safety guard blocks risky shadow pick and tracks counters", () => {
  const candidates: ShadowValueCandidateInput[] = [
    {
      taskType: "role_play",
      actionFamily: "targeted_practice",
      expectedGain: 3.2,
      successProbability: 0.34,
      engagementRisk: 0.29,
      latencyRisk: 0.25,
      explorationBonus: 0.2,
      verificationGain: 0,
      causalRemediationAdjustment: 0,
      baseUtility: 2.1,
      utility: 2.1,
    },
    {
      taskType: "qa_prompt",
      actionFamily: "diagnostic_probe",
      expectedGain: 2.8,
      successProbability: 0.68,
      engagementRisk: 0.08,
      latencyRisk: 0.1,
      explorationBonus: 0.15,
      verificationGain: 0.55,
      causalRemediationAdjustment: 0,
      baseUtility: 2,
      utility: 2,
    },
  ];

  const trace = __internal.evaluateShadowDecisionFromPriors({
    now: new Date("2026-02-18T00:00:00Z"),
    rulesChosenTaskType: "qa_prompt",
    requiresVerificationCoverage: true,
    priors: {
      generatedAt: "2026-02-18T00:00:00Z",
      windowDays: 30,
      sampleSize: 3,
      globalMean: 0.5,
      priorByTaskType: {
        role_play: 1.2,
        qa_prompt: 0.2,
      },
      priorRows: [
        { taskType: "role_play", count: 2, meanReward: 1.3, shrinkedReward: 1.2 },
        { taskType: "qa_prompt", count: 1, meanReward: 0.2, shrinkedReward: 0.2 },
      ],
    },
    candidates,
  });

  assert.equal(trace.shadowChosenTaskType, "role_play");
  assert.equal(trace.disagreement, true);
  assert.equal(trace.blockedBySafetyGuard, true);
  assert.equal(trace.shadowChosenTaskTypeAfterSafety, "qa_prompt");
  assert.equal(trace.disagreementAfterSafety, false);
  assert.equal(trace.safetyCounters.blockedBySafetyGuardCount, 1);
  assert.equal(trace.safetyCounters.verificationGuardTrips, 1);
});

test("shadow ranking tie resolves by lexical task type order", () => {
  const candidates: ShadowValueCandidateInput[] = [
    {
      taskType: "role_play",
      actionFamily: "targeted_practice",
      expectedGain: 0,
      successProbability: 0.5,
      engagementRisk: 0,
      latencyRisk: 0,
      explorationBonus: 0,
      verificationGain: 0,
      causalRemediationAdjustment: 0,
      baseUtility: 0,
      utility: 0,
    },
    {
      taskType: "qa_prompt",
      actionFamily: "targeted_practice",
      expectedGain: 0,
      successProbability: 0.5,
      engagementRisk: 0,
      latencyRisk: 0,
      explorationBonus: 0,
      verificationGain: 0,
      causalRemediationAdjustment: 0,
      baseUtility: 0,
      utility: 0,
    },
  ];

  const trace = __internal.evaluateShadowDecisionFromPriors({
    now: new Date("2026-02-18T00:00:00Z"),
    rulesChosenTaskType: "qa_prompt",
    requiresVerificationCoverage: false,
    priors: {
      generatedAt: "2026-02-18T00:00:00Z",
      windowDays: 30,
      sampleSize: 0,
      globalMean: 0,
      priorByTaskType: {},
      priorRows: [],
    },
    candidates,
  });

  assert.equal(trace.shadowChosenTaskType, "qa_prompt");
});
