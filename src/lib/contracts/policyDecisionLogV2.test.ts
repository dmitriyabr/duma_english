import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePolicyDecisionLogV2Row,
  validatePolicyDecisionLogV2Row,
} from "./policyDecisionLogV2";

test("normalizePolicyDecisionLogV2Row keeps expected candidate score mapping", () => {
  const normalized = normalizePolicyDecisionLogV2Row({
    decisionLogId: "dec_1",
    studentId: "stu_1",
    policyVersion: "policy-rules-v1",
    contextSnapshotId: "twin_1",
    candidateActionSet: ["targeted_practice", "diagnostic_probe"],
    preActionScores: {
      targeted_practice: 0.57,
      diagnostic_probe: 0.42,
    },
    propensity: 0.61,
    activeConstraints: ["target_nodes_required"],
    linkageTaskId: "task_1",
    linkageAttemptId: "att_1",
    linkageSessionId: "sess_1",
    source: "sql_trigger_v1",
  });

  assert.deepEqual(normalized.candidateActionSet, ["targeted_practice", "diagnostic_probe"]);
  assert.equal(normalized.preActionScores.targeted_practice, 0.57);
});

test("validatePolicyDecisionLogV2Row reports missing linkage and propensity", () => {
  const validation = validatePolicyDecisionLogV2Row({
    decisionLogId: "dec_2",
    studentId: "stu_1",
    policyVersion: "policy-rules-v1",
    candidateActionSet: ["targeted_practice"],
    preActionScores: {
      targeted_practice: 0.57,
    },
    activeConstraints: ["target_nodes_required"],
    source: "sql_trigger_v1",
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.issues.includes("missing contextSnapshotId"), true);
  assert.equal(validation.issues.includes("missing linkageTaskId"), true);
  assert.equal(validation.issues.includes("missing linkageAttemptId"), true);
  assert.equal(validation.issues.includes("missing propensity"), true);
});
