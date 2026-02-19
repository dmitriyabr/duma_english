import assert from "node:assert/strict";
import test from "node:test";
import {
  selectDelayedVerificationTaskType,
  validateDelayedVerificationNonDuplicate,
} from "./delayedVerification";

test("selectDelayedVerificationTaskType chooses a different family", () => {
  assert.equal(selectDelayedVerificationTaskType("qa_prompt"), "role_play");
  assert.equal(selectDelayedVerificationTaskType("target_vocab"), "qa_prompt");
  assert.equal(selectDelayedVerificationTaskType("argumentation"), "register_switch");
  assert.equal(selectDelayedVerificationTaskType("register_switch"), "misunderstanding_repair");
  assert.equal(selectDelayedVerificationTaskType("unknown_type"), "qa_prompt");
});

test("validator rejects duplicate task family", () => {
  const validation = validateDelayedVerificationNonDuplicate({
    sourceTaskType: "qa_prompt",
    delayedTaskType: "qa_prompt",
    sourcePrompt: "Explain your daily routine.",
    delayedPrompt: "Describe your routine in detail.",
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.duplicateTaskFamily, true);
  assert.equal(validation.reasons.includes("duplicate_task_family"), true);
});

test("validator rejects near-duplicate prompt formulation", () => {
  const validation = validateDelayedVerificationNonDuplicate({
    sourceTaskType: "qa_prompt",
    delayedTaskType: "role_play",
    sourcePrompt: "Describe your favorite teacher and why.",
    delayedPrompt: "Describe your favorite teacher and why.",
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.duplicatePromptFormulation, true);
  assert.equal(validation.reasons.includes("duplicate_prompt_formulation"), true);
});

test("validator accepts different family and formulation", () => {
  const validation = validateDelayedVerificationNonDuplicate({
    sourceTaskType: "qa_prompt",
    delayedTaskType: "role_play",
    sourcePrompt: "Describe your school day.",
    delayedPrompt: "Role-play asking a friend to plan a weekend activity.",
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.reasons, []);
});
