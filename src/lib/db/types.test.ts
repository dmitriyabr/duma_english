import assert from "node:assert/strict";
import test from "node:test";
import {
  CAUSAL_TAXONOMY_V1_VERSION,
  adaptLegacyCausalDiagnosisPayload,
  autopilotDelayedOutcomeContractSchema,
  autopilotEventLogContractSchema,
  anchorEvalRunContractSchema,
  anchorEvalSeedRowSchema,
  causalDiagnosisContractSchema,
  learnerTwinSnapshotContractSchema,
  oodTaskSpecContractSchema,
  policyDecisionLogV2ContractSchema,
  reviewQueueItemContractSchema,
  rewardTraceContractSchema,
  selfRepairCycleContractSchema,
} from "./types";

test("causal diagnosis contract accepts v1 payload", () => {
  const parsed = causalDiagnosisContractSchema.parse({
    attemptId: "att_1",
    studentId: "stu_1",
    modelVersion: "causal-v1",
    topLabel: "rule_confusion",
    topProbability: 0.62,
    topMargin: 0.15,
    distribution: [
      { label: "rule_confusion", p: 0.62 },
      { label: "retrieval_failure", p: 0.21 },
      { label: "mixed", p: 0.1 },
      { label: "unknown", p: 0.07 },
    ],
    confidenceInterval: {
      lower: 0.55,
      upper: 0.69,
    },
  });

  assert.equal(parsed.modelVersion, "causal-v1");
});

test("causal diagnosis contract normalizes legacy label tokens", () => {
  const parsed = causalDiagnosisContractSchema.parse({
    attemptId: "att_legacy_token",
    studentId: "stu_legacy_token",
    modelVersion: "causal-v1",
    topLabel: "Rule Error",
    topProbability: 0.6,
    distribution: [
      { label: "Rule Error", p: 0.6 },
      { label: "Memory Lapse", p: 0.25 },
      { label: "Multi Cause", p: 0.15 },
    ],
  });

  assert.equal(parsed.topLabel, "rule_confusion");
  assert.deepEqual(
    parsed.distribution.map((row) => row.label),
    ["rule_confusion", "retrieval_failure", "mixed"]
  );
});

test("legacy adapter upgrades old causal payload to v1 contract", () => {
  const parsed = adaptLegacyCausalDiagnosisPayload({
    attemptId: "att_legacy",
    studentId: "stu_legacy",
    model: "legacy-causal-v0",
    topCause: "grammar_confusion",
    topP: 0.57,
    causes: [
      { cause: "grammar_confusion", probability: 57 },
      { cause: "memory_lapse", probability: 30 },
      { cause: "other", probability: 13 },
    ],
    confidenceInterval: {
      lower: 0.5,
      upper: 0.63,
    },
  });

  assert.equal(parsed.taxonomyVersion, CAUSAL_TAXONOMY_V1_VERSION);
  assert.equal(parsed.modelVersion, "legacy-causal-v0");
  assert.equal(parsed.topLabel, "rule_confusion");
  assert.equal(parsed.distribution.length, 3);
  assert.equal(
    parsed.distribution.reduce((sum, row) => sum + row.p, 0).toFixed(6),
    "1.000000"
  );
});

test("learner twin snapshot contract accepts minimal payload", () => {
  const parsed = learnerTwinSnapshotContractSchema.parse({
    studentId: "stu_1",
    masteryProjection: {
      stage: "A2",
      uncertainty: 0.37,
    },
  });

  assert.equal(parsed.studentId, "stu_1");
  assert.equal(parsed.source, "attempt_update");
});

test("ood task spec contract enforces known axis tags", () => {
  const result = oodTaskSpecContractSchema.safeParse({
    studentId: "stu_1",
    axisTags: ["topic", "register", "unsupported_axis"],
  });

  assert.equal(result.success, false);
});

test("self-repair cycle contract enforces loop index >= 1", () => {
  const result = selfRepairCycleContractSchema.safeParse({
    studentId: "stu_1",
    sourceAttemptId: "att_1",
    loopIndex: 0,
  });

  assert.equal(result.success, false);
});

test("review queue item contract enforces dueAt", () => {
  const parsed = reviewQueueItemContractSchema.parse({
    studentId: "stu_1",
    nodeId: "gse:node:1",
    dueAt: new Date("2026-02-18T00:00:00Z"),
  });

  assert.equal(parsed.status, "pending");
});

test("reward trace contract enforces reward equation", () => {
  const success = rewardTraceContractSchema.safeParse({
    studentId: "stu_1",
    decisionLogId: "dec_1",
    rewardVersion: "reward-v1",
    masteryDelta: 0.8,
    transferReward: 0.3,
    retentionReward: 0.2,
    frictionPenalty: 0.1,
    totalReward: 1.2,
  });

  assert.equal(success.success, true);

  const failure = rewardTraceContractSchema.safeParse({
    studentId: "stu_1",
    decisionLogId: "dec_1",
    rewardVersion: "reward-v1",
    masteryDelta: 0.8,
    transferReward: 0.3,
    retentionReward: 0.2,
    frictionPenalty: 0.1,
    totalReward: 9,
  });

  assert.equal(failure.success, false);
});

test("anchor eval contracts accept run and seed rows", () => {
  const run = anchorEvalRunContractSchema.parse({
    policyVersion: "policy-v3",
    rewardVersion: "reward-v1",
    datasetVersion: "anchor-eval-2026-02-17",
    status: "completed",
    startedAt: new Date("2026-02-17T00:00:00Z"),
    completedAt: new Date("2026-02-17T01:00:00Z"),
    reportUri: "https://example.com/anchor-eval/report",
  });

  const seed = anchorEvalSeedRowSchema.parse({
    id: "seed_anchor_eval_run_v1",
    policyVersion: "policy-bootstrap-v1",
    rewardVersion: "reward-v1",
    datasetVersion: "dataset-bootstrap-v1",
    status: "completed",
    notes: "Bootstrap seed row for CH-02 data model v2 validation.",
  });

  assert.equal(run.status, "completed");
  assert.equal(seed.id, "seed_anchor_eval_run_v1");
});

test("autopilot delayed outcome contract accepts minimal payload", () => {
  const parsed = autopilotDelayedOutcomeContractSchema.parse({
    studentId: "stu_1",
    decisionLogId: "dec_1",
    taskId: "task_1",
    attemptId: "att_1",
    outcome: {
      masteryDeltaTotal: 1.25,
      evidenceCount: 8,
    },
  });

  assert.equal(parsed.outcomeWindow, "same_session");
  assert.equal(parsed.status, "recorded");
});

test("autopilot event contract enforces full linkage for evidence rows", () => {
  const success = autopilotEventLogContractSchema.safeParse({
    eventType: "evidence_written",
    studentId: "stu_1",
    decisionLogId: "dec_1",
    taskId: "task_1",
    attemptId: "att_1",
    evidenceId: "ev_1",
    delayedOutcomeId: "out_1",
  });
  assert.equal(success.success, true);

  const failure = autopilotEventLogContractSchema.safeParse({
    eventType: "evidence_written",
    studentId: "stu_1",
    evidenceId: "ev_1",
  });
  assert.equal(failure.success, false);
});

test("policy decision log v2 contract validates candidate/preAction alignment", () => {
  const success = policyDecisionLogV2ContractSchema.safeParse({
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
    activeConstraints: ["target_nodes_required", "verification_sla"],
    linkageTaskId: "task_1",
    linkageAttemptId: "att_1",
    linkageSessionId: "sess_1",
    source: "sql_trigger_v1",
  });
  assert.equal(success.success, true);

  const failure = policyDecisionLogV2ContractSchema.safeParse({
    decisionLogId: "dec_2",
    studentId: "stu_1",
    policyVersion: "policy-rules-v1",
    candidateActionSet: ["targeted_practice", "diagnostic_probe"],
    preActionScores: {
      targeted_practice: 0.57,
    },
    activeConstraints: ["target_nodes_required"],
    source: "sql_trigger_v1",
  });
  assert.equal(failure.success, false);
});
