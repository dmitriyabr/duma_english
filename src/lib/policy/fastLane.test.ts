import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFastLaneOodRate,
  applyFastLaneToDiagnosticMode,
  evaluateFastLaneDecision,
} from "./fastLane";

test("evaluateFastLaneDecision activates fast-lane for high-confidence learner between milestones", () => {
  const decision = evaluateFastLaneDecision({
    projectionConfidence: 0.86,
    placementConfidence: 0.82,
    placementUncertainty: 0.18,
    promotionReady: false,
    stressGateRequired: false,
    targetStageCoverage70: 0.74,
    coldStartActive: false,
    placementFresh: false,
  });

  assert.equal(decision.highConfidence, true);
  assert.equal(decision.betweenMilestoneGates, true);
  assert.equal(decision.warmupComplete, true);
  assert.equal(decision.eligible, true);
  assert.equal(decision.reduceDiagnosticDensity, true);
  assert.equal(decision.oodBudgetRateDelta, -0.02);

  assert.equal(applyFastLaneToDiagnosticMode(true, decision), false);
  assert.equal(applyFastLaneOodRate(0.14, decision), 0.12);
});

test("evaluateFastLaneDecision blocks fast-lane when milestone gate window is active", () => {
  const decision = evaluateFastLaneDecision({
    projectionConfidence: 0.91,
    placementConfidence: 0.88,
    placementUncertainty: 0.12,
    promotionReady: true,
    stressGateRequired: false,
    targetStageCoverage70: 0.98,
    coldStartActive: false,
    placementFresh: false,
  });

  assert.equal(decision.highConfidence, true);
  assert.equal(decision.betweenMilestoneGates, false);
  assert.equal(decision.eligible, false);
  assert.equal(decision.oodBudgetRateDelta, 0);

  assert.equal(applyFastLaneToDiagnosticMode(true, decision), true);
  assert.equal(applyFastLaneOodRate(0.14, decision), 0.14);
});

test("evaluateFastLaneDecision blocks fast-lane while warmup is active", () => {
  const decision = evaluateFastLaneDecision({
    projectionConfidence: 0.9,
    placementConfidence: 0.82,
    placementUncertainty: 0.2,
    promotionReady: false,
    stressGateRequired: false,
    targetStageCoverage70: 0.65,
    coldStartActive: true,
    placementFresh: false,
  });

  assert.equal(decision.highConfidence, true);
  assert.equal(decision.warmupComplete, false);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reasons.includes("warmup_active"), true);
});
