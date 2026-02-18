import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAmbiguityTrigger, mapTaskTypeToActionFamily } from "./ambiguityTrigger";

test("task type -> action family mapping remains deterministic", () => {
  assert.equal(mapTaskTypeToActionFamily("target_vocab"), "targeted_practice");
  assert.equal(mapTaskTypeToActionFamily("role_play"), "transfer_probe");
  assert.equal(mapTaskTypeToActionFamily("read_aloud"), "diagnostic_probe");
});

test("ambiguity trigger is skipped when causal snapshot is absent", () => {
  const result = evaluateAmbiguityTrigger({
    chosenTaskType: "target_vocab",
    candidates: [
      { taskType: "target_vocab", utility: 0.9 },
      { taskType: "read_aloud", utility: 0.4 },
    ],
    causalSnapshot: null,
  });

  assert.equal(result.evaluated, false);
  assert.equal(result.triggered, false);
  assert.ok(result.reasonCodes.includes("no_causal_snapshot"));
});

test("ambiguity trigger fires only when posterior is ambiguous and action instability is material", () => {
  const result = evaluateAmbiguityTrigger({
    chosenTaskType: "target_vocab",
    candidates: [
      { taskType: "target_vocab", utility: 1.05 },
      { taskType: "speech_builder", utility: 0.92 },
      { taskType: "role_play", utility: 0.38 },
      { taskType: "read_aloud", utility: 0.62 },
    ],
    causalSnapshot: {
      topLabel: "rule_confusion",
      entropy: 0.74,
      topMargin: 0.07,
      distributionJson: [
        { label: "rule_confusion", p: 0.44 },
        { label: "l1_interference", p: 0.36 },
        { label: "unknown", p: 0.2 },
      ],
    },
  });

  assert.equal(result.evaluated, true);
  assert.equal(result.posteriorAmbiguous, true);
  assert.equal(result.materialInstability, true);
  assert.equal(result.shouldTrigger, true);
  assert.equal(result.triggered, true);
  assert.equal(result.wouldChangeDecision, true);
  assert.equal(result.recommendedProbeTaskType, "read_aloud");
  assert.equal(result.topCauseLabels[0], "rule_confusion");
  assert.equal(result.topCauseLabels[1], "l1_interference");
});

test("ambiguity trigger does not flip when diagnostic probe is already selected", () => {
  const result = evaluateAmbiguityTrigger({
    chosenTaskType: "read_aloud",
    candidates: [
      { taskType: "target_vocab", utility: 1.01 },
      { taskType: "role_play", utility: 0.41 },
      { taskType: "read_aloud", utility: 0.63 },
    ],
    causalSnapshot: {
      topLabel: "rule_confusion",
      entropy: 0.79,
      topMargin: 0.05,
      distributionJson: [
        { label: "rule_confusion", p: 0.47 },
        { label: "l1_interference", p: 0.37 },
        { label: "unknown", p: 0.16 },
      ],
    },
  });

  assert.equal(result.shouldTrigger, true);
  assert.equal(result.wouldChangeDecision, false);
  assert.equal(result.triggered, false);
  assert.ok(result.reasonCodes.includes("diagnostic_probe_already_selected"));
});

test("high confidence posterior blocks trigger even with large action gap", () => {
  const result = evaluateAmbiguityTrigger({
    chosenTaskType: "target_vocab",
    candidates: [
      { taskType: "target_vocab", utility: 1.12 },
      { taskType: "role_play", utility: 0.31 },
      { taskType: "read_aloud", utility: 0.49 },
    ],
    causalSnapshot: {
      topLabel: "rule_confusion",
      entropy: 0.42,
      topMargin: 0.33,
      distributionJson: [
        { label: "rule_confusion", p: 0.71 },
        { label: "l1_interference", p: 0.15 },
        { label: "unknown", p: 0.14 },
      ],
    },
  });

  assert.equal(result.posteriorAmbiguous, false);
  assert.equal(result.materialInstability, true);
  assert.equal(result.shouldTrigger, false);
  assert.equal(result.triggered, false);
});
