import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCausalRemediationPolicy } from "./remediationPolicy";

const TASK_TYPES = ["read_aloud", "target_vocab", "role_play"];

function adjustmentFor(policy: ReturnType<typeof evaluateCausalRemediationPolicy>, taskType: string) {
  const row = policy.adjustments.find((item) => item.taskType === taskType);
  assert.ok(row, `Missing adjustment for ${taskType}`);
  return row!;
}

test("remediation policy keeps zero offsets without causal snapshot", () => {
  const policy = evaluateCausalRemediationPolicy({
    taskTypes: TASK_TYPES,
    causalSnapshot: null,
  });

  assert.equal(policy.trace.evaluated, false);
  assert.equal(policy.trace.topCauseLabel, null);
  assert.ok(policy.trace.reasonCodes.includes("no_causal_snapshot"));
  for (const row of policy.adjustments) {
    assert.equal(row.adjustment, 0);
    assert.equal(row.alignment, "neutral");
  }
});

test("rule_confusion favors targeted practice over transfer probes", () => {
  const policy = evaluateCausalRemediationPolicy({
    taskTypes: TASK_TYPES,
    causalSnapshot: {
      topLabel: "rule_confusion",
      entropy: 0.22,
      topMargin: 0.43,
      distributionJson: [
        { label: "rule_confusion", p: 0.76 },
        { label: "retrieval_failure", p: 0.16 },
        { label: "unknown", p: 0.08 },
      ],
    },
  });

  const diagnostic = adjustmentFor(policy, "read_aloud");
  const targeted = adjustmentFor(policy, "target_vocab");
  const transfer = adjustmentFor(policy, "role_play");

  assert.equal(policy.trace.topCauseLabel, "rule_confusion");
  assert.ok(targeted.adjustment > diagnostic.adjustment);
  assert.ok(targeted.adjustment > 0);
  assert.equal(targeted.alignment, "preferred");
  assert.ok(transfer.adjustment < 0);
  assert.equal(transfer.alignment, "discouraged");
});

test("l1_interference boosts transfer probes and suppresses diagnostics", () => {
  const policy = evaluateCausalRemediationPolicy({
    taskTypes: TASK_TYPES,
    ageBand: "9-11",
    domainByTaskType: {
      read_aloud: "grammar",
      target_vocab: "vocab",
      role_play: "lo",
    },
    languageSignals: {
      primaryTag: "swahili",
      tagSet: ["english", "swahili", "sheng"],
      codeSwitchDetected: true,
      homeLanguageHints: ["kikuyu"],
    },
    causalSnapshot: {
      topLabel: "l1_interference",
      entropy: 0.27,
      topMargin: 0.39,
      distributionJson: [
        { label: "l1_interference", p: 0.73 },
        { label: "rule_confusion", p: 0.14 },
        { label: "unknown", p: 0.13 },
      ],
    },
  });

  const diagnostic = adjustmentFor(policy, "read_aloud");
  const targeted = adjustmentFor(policy, "target_vocab");
  const transfer = adjustmentFor(policy, "role_play");

  assert.equal(policy.trace.topCauseLabel, "l1_interference");
  assert.equal(policy.trace.interferencePrior.version, "l1-interference-prior-v1");
  assert.ok((policy.trace.interferencePrior.languageSignalScore || 0) > 0);
  assert.ok(transfer.adjustment > targeted.adjustment);
  assert.ok(transfer.adjustment > 0);
  assert.equal(transfer.alignment, "preferred");
  assert.equal(transfer.domain, "lo");
  assert.ok(transfer.interferencePriorBoost > 0);
  assert.equal(typeof transfer.templateKey, "string");
  assert.ok(policy.trace.templateRecommendations.length > 0);
  assert.ok(diagnostic.adjustment < 0);
});

test("high ambiguity softens but does not erase cause-driven offsets", () => {
  const confident = evaluateCausalRemediationPolicy({
    taskTypes: TASK_TYPES,
    causalSnapshot: {
      topLabel: "instruction_misread",
      entropy: 0.18,
      topMargin: 0.48,
      distributionJson: [
        { label: "instruction_misread", p: 0.81 },
        { label: "attention_loss", p: 0.12 },
        { label: "unknown", p: 0.07 },
      ],
    },
  });
  const uncertain = evaluateCausalRemediationPolicy({
    taskTypes: TASK_TYPES,
    causalSnapshot: {
      topLabel: "instruction_misread",
      entropy: 0.84,
      topMargin: 0.05,
      distributionJson: [
        { label: "instruction_misread", p: 0.41 },
        { label: "attention_loss", p: 0.34 },
        { label: "unknown", p: 0.25 },
      ],
    },
  });

  const confidentDiagnostic = adjustmentFor(confident, "read_aloud").adjustment;
  const uncertainDiagnostic = adjustmentFor(uncertain, "read_aloud").adjustment;
  assert.ok(confidentDiagnostic > uncertainDiagnostic);
  assert.ok(uncertainDiagnostic > 0);
  assert.ok(
    uncertain.trace.reasonCodes.includes("low_confidence_softened_adjustments")
  );
});

test("language-signal priors increase template-ready transfer adjustment", () => {
  const baseline = evaluateCausalRemediationPolicy({
    taskTypes: ["role_play"],
    ageBand: "12-14",
    domainByTaskType: {
      role_play: "lo",
    },
    causalSnapshot: {
      topLabel: "l1_interference",
      entropy: 0.38,
      topMargin: 0.22,
      distributionJson: [
        { label: "l1_interference", p: 0.52 },
        { label: "rule_confusion", p: 0.21 },
        { label: "unknown", p: 0.27 },
      ],
    },
  });
  const enriched = evaluateCausalRemediationPolicy({
    taskTypes: ["role_play"],
    ageBand: "12-14",
    domainByTaskType: {
      role_play: "lo",
    },
    languageSignals: {
      primaryTag: "sheng",
      tagSet: ["english", "sheng"],
      codeSwitchDetected: true,
      homeLanguageHints: ["luo"],
    },
    causalSnapshot: {
      topLabel: "l1_interference",
      entropy: 0.38,
      topMargin: 0.22,
      distributionJson: [
        { label: "l1_interference", p: 0.52 },
        { label: "rule_confusion", p: 0.21 },
        { label: "unknown", p: 0.27 },
      ],
    },
  });

  const baselineTransfer = adjustmentFor(baseline, "role_play");
  const enrichedTransfer = adjustmentFor(enriched, "role_play");

  assert.ok(enrichedTransfer.adjustment > baselineTransfer.adjustment);
  assert.ok(enrichedTransfer.interferencePriorBoost > baselineTransfer.interferencePriorBoost);
  assert.equal(enrichedTransfer.templateKey, "l1_discourse_repair_12_14");
});
