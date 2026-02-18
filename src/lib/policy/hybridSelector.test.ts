import assert from "node:assert/strict";
import test from "node:test";

import { runGuardrailedHybridSelector } from "@/lib/policy/hybridSelector";

test("blocks actions that violate hard constraints", () => {
  const result = runGuardrailedHybridSelector({
    candidates: [
      {
        actionId: "speech_builder",
        ruleUtility: 0.9,
        learnedValue: 1.8,
        hardConstraintReasons: ["verification_sla"],
      },
      {
        actionId: "qa_prompt",
        ruleUtility: 0.8,
        learnedValue: 1.1,
      },
      {
        actionId: "target_vocab",
        ruleUtility: 0.7,
        learnedValue: 0.9,
      },
    ],
    explorationFloor: 0.1,
  });

  assert.equal(result.candidateActionSet.includes("speech_builder"), false);
  assert.equal(result.chosenAction, "qa_prompt");
  assert.deepEqual(result.constraintMask.speech_builder, ["verification_sla"]);
  assert.equal(result.activeConstraints.includes("verification_sla"), true);
  assert.equal(result.blockedActions.includes("speech_builder"), true);
});

test("applies non-zero exploration floor to every feasible action", () => {
  const result = runGuardrailedHybridSelector({
    candidates: [
      { actionId: "a", ruleUtility: 1.2, learnedValue: 1.2 },
      { actionId: "b", ruleUtility: 0.5, learnedValue: 0.5 },
      { actionId: "c", ruleUtility: -0.2, learnedValue: -0.2 },
    ],
    explorationFloor: 0.12,
    temperature: 0.25,
  });

  const probabilities = Object.values(result.propensityByAction);
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  for (const value of probabilities) {
    assert.equal(value >= 0.12, true);
  }
  assert.equal(Math.abs(total - 1) < 0.001, true);
});

test("falls back to a deterministic choice when all actions are constrained", () => {
  const result = runGuardrailedHybridSelector({
    candidates: [
      {
        actionId: "target_vocab",
        ruleUtility: 0.7,
        learnedValue: 1.2,
        hardConstraintReasons: ["diagnostic_diversity_guard"],
      },
      {
        actionId: "qa_prompt",
        ruleUtility: 1.1,
        learnedValue: 0.9,
        hardConstraintReasons: ["verification_sla"],
      },
    ],
  });

  assert.equal(result.fallbackApplied, true);
  assert.equal(result.chosenAction, "qa_prompt");
  assert.equal(result.propensity, 1);
  assert.deepEqual(result.candidateActionSet, ["qa_prompt"]);
  assert.equal(result.activeConstraints.includes("hard_constraint_fallback"), true);
});

test("uses lexical tie-break for equal propensity and score", () => {
  const result = runGuardrailedHybridSelector({
    candidates: [
      { actionId: "b_action", ruleUtility: 1, learnedValue: 1 },
      { actionId: "a_action", ruleUtility: 1, learnedValue: 1 },
    ],
    explorationFloor: 0,
    temperature: 2,
  });

  assert.equal(result.chosenAction, "a_action");
});
