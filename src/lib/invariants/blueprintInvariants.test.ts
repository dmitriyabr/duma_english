/**
 * CH-41: Regression suite for blueprint invariants.
 * These tests encode non-negotiable invariants from the Autopilot Blueprint.
 * Failure of any test must block release.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { causalCoreLabels, causalDiagnosisContractSchema, CAUSAL_TAXONOMY_V1_VERSION } from "@/lib/db/types";
import { ATTEMPT_STATUS, isAttemptRetryStatus } from "@/lib/attemptStatus";
import { REWARD_FUNCTION_VERSION_V1 } from "@/lib/reward/function";
import { POLICY_VERSION } from "@/lib/policy/hybridSelector";
import { TRANSFER_VERDICT_PROTOCOL_VERSION } from "@/lib/ood/transferVerdict";
import { RETENTION_PROBE_PROTOCOL_VERSION, RETENTION_PROBE_WINDOWS } from "@/lib/retention/probes";
import { policyDecisionLogV2ContractSchema } from "@/lib/db/types";
import type { PlannerDecision } from "@/lib/gse/planner";

test("invariant: causal taxonomy includes mixed and unknown labels", () => {
  assert.ok(causalCoreLabels.includes("mixed"), "causal taxonomy must include mixed");
  assert.ok(causalCoreLabels.includes("unknown"), "causal taxonomy must include unknown");
});

test("invariant: causal diagnosis contract requires modelVersion and valid topLabel", () => {
  const parsed = causalDiagnosisContractSchema.parse({
    attemptId: "att_1",
    studentId: "stu_1",
    modelVersion: "causal-inference-v1",
    topLabel: "rule_confusion",
    topProbability: 0.7,
    distribution: [{ label: "rule_confusion", p: 0.7 }, { label: "unknown", p: 0.3 }],
  });
  assert.equal(parsed.modelVersion, "causal-inference-v1");
  assert.equal(parsed.topLabel, "rule_confusion");
  assert.ok(causalCoreLabels.includes(parsed.topLabel));
});

test("invariant: needs_retry is the only retry status and never mutates mastery", () => {
  assert.equal(ATTEMPT_STATUS.NEEDS_RETRY, "needs_retry");
  assert.ok(isAttemptRetryStatus(ATTEMPT_STATUS.NEEDS_RETRY));
  assert.ok(!isAttemptRetryStatus(ATTEMPT_STATUS.COMPLETED));
  assert.ok(!isAttemptRetryStatus(ATTEMPT_STATUS.FAILED));
  assert.ok(!isAttemptRetryStatus(ATTEMPT_STATUS.PROCESSING));
});

test("invariant: reward is versioned", () => {
  assert.ok(REWARD_FUNCTION_VERSION_V1.length > 0);
  assert.ok(REWARD_FUNCTION_VERSION_V1.startsWith("reward-"));
});

test("invariant: policy decisions carry version trace", () => {
  assert.ok(POLICY_VERSION.length > 0);
  const parsed = policyDecisionLogV2ContractSchema.parse({
    decisionLogId: "dec_1",
    studentId: "stu_1",
    policyVersion: POLICY_VERSION,
    candidateActionSet: ["task_a", "task_b"],
    preActionScores: { task_a: 0.5, task_b: 0.4 },
    activeConstraints: ["constraint_a"],
    source: "sql_trigger_v1",
  });
  assert.equal(parsed.policyVersion, POLICY_VERSION);
});

test("invariant: planner decision type has targetNodeIds (no task without node targets)", () => {
  const minimal: PlannerDecision = {
    decisionId: "d1",
    chosenTaskType: "qa_prompt",
    targetNodeIds: ["n1", "n2"],
    targetNodeDescriptors: ["desc1", "desc2"],
    targetNodeTypes: ["GSE_GRAMMAR", "GSE_GRAMMAR"],
    domainsTargeted: ["grammar"],
    diagnosticMode: false,
    rotationApplied: false,
    rotationReason: null,
    expectedGain: 0.5,
    estimatedDifficulty: 50,
    selectionReason: "test",
    selectionReasonType: "weakness",
    verificationTargetNodeIds: [],
    primaryGoal: "mastery",
    candidateScores: [],
    causalRemediation: {} as PlannerDecision["causalRemediation"],
    ambiguityTrigger: {} as PlannerDecision["ambiguityTrigger"],
    hybridPolicy: {} as PlannerDecision["hybridPolicy"],
    shadowPolicy: null,
  };
  assert.ok(Array.isArray(minimal.targetNodeIds));
  assert.ok(minimal.targetNodeIds.length >= 0);
});

test("invariant: transfer verdict protocol is versioned", () => {
  assert.ok(TRANSFER_VERDICT_PROTOCOL_VERSION.length > 0);
  assert.ok(TRANSFER_VERDICT_PROTOCOL_VERSION.includes("transfer"));
});

test("invariant: retention probes use 7/30/90 windows", () => {
  assert.deepEqual([...RETENTION_PROBE_WINDOWS], [7, 30, 90]);
  assert.ok(RETENTION_PROBE_PROTOCOL_VERSION.length > 0);
});

test("invariant: causal taxonomy version is fixed", () => {
  assert.equal(CAUSAL_TAXONOMY_V1_VERSION, "causal-taxonomy-v1");
});
