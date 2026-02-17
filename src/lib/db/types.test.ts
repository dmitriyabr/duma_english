import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorEvalRunContractSchema,
  anchorEvalSeedRowSchema,
  causalDiagnosisContractSchema,
  learnerTwinSnapshotContractSchema,
  oodTaskSpecContractSchema,
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
