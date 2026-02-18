import assert from "node:assert/strict";
import test from "node:test";
import {
  IMMEDIATE_SELF_REPAIR_TASK_SCORE_THRESHOLD,
  buildImmediateSelfRepairPrompt,
  shouldTriggerImmediateSelfRepair,
} from "./immediateLoop";

test("self-repair trigger opens immediate loop for low task score", () => {
  const shouldTrigger = shouldTriggerImmediateSelfRepair({
    taskType: "qa_prompt",
    taskMeta: {},
    taskEvaluation: {
      taskScore: IMMEDIATE_SELF_REPAIR_TASK_SCORE_THRESHOLD - 5,
    },
  });

  assert.equal(shouldTrigger, true);
});

test("self-repair trigger ignores already-marked immediate retry tasks", () => {
  const shouldTrigger = shouldTriggerImmediateSelfRepair({
    taskType: "qa_prompt",
    taskMeta: {
      selfRepair: {
        mode: "immediate_retry",
      },
    },
    taskEvaluation: {
      taskScore: 40,
    },
  });

  assert.equal(shouldTrigger, false);
});

test("self-repair trigger ignores read-aloud tasks", () => {
  const shouldTrigger = shouldTriggerImmediateSelfRepair({
    taskType: "read_aloud",
    taskMeta: {},
    taskEvaluation: {
      taskScore: 20,
    },
  });

  assert.equal(shouldTrigger, false);
});

test("immediate self-repair prompt includes cause and feedback hints", () => {
  const prompt = buildImmediateSelfRepairPrompt({
    sourcePrompt: "Describe your weekend plans.",
    causeLabel: "rule_confusion",
    feedback: {
      message: "Use present continuous for planned actions.",
    },
  });

  assert.equal(prompt.includes("rule_confusion"), true);
  assert.equal(prompt.includes("present continuous"), true);
  assert.equal(prompt.includes("Describe your weekend plans"), true);
});
