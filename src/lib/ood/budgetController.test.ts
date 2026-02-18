import assert from "node:assert/strict";
import test from "node:test";
import { computeOodBudgetDecision } from "./budgetController";

test("computeOodBudgetDecision uses base budget in 10-20% range", () => {
  const decision = computeOodBudgetDecision({
    taskOrdinal: 7,
    selectionReasonType: "weakness",
    primaryGoal: "lift_weak_nodes",
    recentSignals: [],
  });

  assert.ok(decision.budgetRate >= 0.1 && decision.budgetRate <= 0.2);
  assert.equal(decision.interval, 7);
  assert.equal(decision.shouldInject, true);
});

test("computeOodBudgetDecision increases budget near milestone pressure", () => {
  const decision = computeOodBudgetDecision({
    taskOrdinal: 6,
    selectionReasonType: "verification",
    primaryGoal: "confirm_readiness",
    recentSignals: [],
  });

  assert.equal(decision.milestonePressure, true);
  assert.ok(decision.budgetRate > 0.14);
});

test("computeOodBudgetDecision increases budget on overfit risk from low pass rate", () => {
  const decision = computeOodBudgetDecision({
    taskOrdinal: 5,
    selectionReasonType: "weakness",
    recentSignals: [
      { verdict: "transfer_fail_validated", status: "evaluated", createdAt: new Date("2026-02-18T00:00:00Z") },
      { verdict: "transfer_fail_validated", status: "evaluated", createdAt: new Date("2026-02-17T00:00:00Z") },
      { verdict: "transfer_pass", status: "evaluated", createdAt: new Date("2026-02-16T00:00:00Z") },
    ],
  });

  assert.equal(decision.overfitRisk, true);
  assert.ok(decision.budgetRate > 0.14);
});

test("computeOodBudgetDecision clamps at max budget when both risk signals are active", () => {
  const decision = computeOodBudgetDecision({
    taskOrdinal: 10,
    selectionReasonType: "verification",
    primaryGoal: "milestone_gate",
    recentSignals: [
      { verdict: "transfer_fail_validated", status: "evaluated", createdAt: new Date("2026-02-18T00:00:00Z") },
      { verdict: "transfer_fail_validated", status: "evaluated", createdAt: new Date("2026-02-17T00:00:00Z") },
      { verdict: "transfer_fail_validated", status: "evaluated", createdAt: new Date("2026-02-16T00:00:00Z") },
      { verdict: "transfer_pass", status: "evaluated", createdAt: new Date("2026-02-15T00:00:00Z") },
    ],
  });

  assert.equal(decision.budgetRate, 0.2);
  assert.equal(decision.interval, 5);
  assert.equal(decision.shouldInject, true);
});

test("computeOodBudgetDecision reduces budget when fast-lane is eligible", () => {
  const decision = computeOodBudgetDecision({
    taskOrdinal: 8,
    selectionReasonType: "weakness",
    primaryGoal: "lift_weak_nodes",
    recentSignals: [],
    fastLane: {
      eligible: true,
      oodBudgetRateDelta: -0.02,
      protocolVersion: "fast-lane-progression-v1",
    },
  });

  assert.equal(decision.fastLaneApplied, true);
  assert.equal(decision.fastLaneProtocolVersion, "fast-lane-progression-v1");
  assert.equal(decision.budgetRate, 0.12);
  assert.equal(decision.interval, 8);
  assert.equal(decision.shouldInject, true);
});
