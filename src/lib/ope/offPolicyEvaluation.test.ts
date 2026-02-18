import assert from "node:assert/strict";
import test from "node:test";
import { __internal } from "./offPolicyEvaluation";

test("summarizeRows excludes incomplete logs and reports reasons", () => {
  const report = __internal.summarizeRows({
    windowDays: 30,
    bootstrapSamples: 100,
    now: new Date("2026-02-18T00:00:00Z"),
    rows: [
      {
        decisionLogId: "d1",
        policyVersion: "policy-rules-v1",
        propensity: 0.5,
        candidateActionSet: ["qa_prompt", "read_aloud"],
        preActionScores: { qa_prompt: 0.9, read_aloud: 0.2 },
        linkageAttemptId: "a1",
        decisionLog: { chosenTaskType: "qa_prompt" },
        attempt: {
          status: "completed",
          completedAt: new Date("2026-02-17T00:00:00Z"),
          taskEvaluationJson: { taskScore: 90 },
        },
      },
      {
        decisionLogId: "d2",
        policyVersion: "policy-rules-v1",
        propensity: null,
        candidateActionSet: ["qa_prompt", "read_aloud"],
        preActionScores: { qa_prompt: 0.8, read_aloud: 0.1 },
        linkageAttemptId: "a2",
        decisionLog: { chosenTaskType: "qa_prompt" },
        attempt: {
          status: "completed",
          completedAt: new Date("2026-02-17T00:00:00Z"),
          taskEvaluationJson: { taskScore: 70 },
        },
      },
    ],
  });

  assert.equal(report.totalRows, 2);
  assert.equal(report.completeRows, 1);
  assert.equal(report.excludedRows, 1);
  assert.ok(report.exclusionReasons.some((row) => row.key === "invalid_propensity"));
});

test("snips metrics return lift and confidence bounds when matched samples exist", () => {
  const report = __internal.summarizeRows({
    windowDays: 30,
    bootstrapSamples: 200,
    now: new Date("2026-02-18T00:00:00Z"),
    rows: [
      {
        decisionLogId: "d1",
        policyVersion: "policy-rules-v1",
        propensity: 0.5,
        candidateActionSet: ["qa_prompt", "read_aloud"],
        preActionScores: { qa_prompt: 1.2, read_aloud: 0.3 },
        linkageAttemptId: "a1",
        decisionLog: { chosenTaskType: "qa_prompt" },
        attempt: {
          status: "completed",
          completedAt: new Date("2026-02-17T00:00:00Z"),
          taskEvaluationJson: { taskScore: 88 },
        },
      },
      {
        decisionLogId: "d2",
        policyVersion: "policy-rules-v1",
        propensity: 0.6,
        candidateActionSet: ["qa_prompt", "read_aloud"],
        preActionScores: { qa_prompt: 1.0, read_aloud: 0.6 },
        linkageAttemptId: "a2",
        decisionLog: { chosenTaskType: "qa_prompt" },
        attempt: {
          status: "completed",
          completedAt: new Date("2026-02-17T00:00:00Z"),
          taskEvaluationJson: { taskScore: 78 },
        },
      },
      {
        decisionLogId: "d3",
        policyVersion: "policy-rules-v1",
        propensity: 0.4,
        candidateActionSet: ["qa_prompt", "read_aloud"],
        preActionScores: { qa_prompt: 0.4, read_aloud: 0.9 },
        linkageAttemptId: "a3",
        decisionLog: { chosenTaskType: "qa_prompt" },
        attempt: {
          status: "completed",
          completedAt: new Date("2026-02-17T00:00:00Z"),
          taskEvaluationJson: { taskScore: 60 },
        },
      },
    ],
  });

  assert.equal(report.completeRows, 3);
  assert.ok(typeof report.metrics.baselineValue === "number");
  assert.ok(typeof report.metrics.targetPolicyValue === "number");
  assert.ok(typeof report.metrics.lift === "number");
  assert.ok(typeof report.metrics.ciLower === "number");
  assert.ok(typeof report.metrics.ciUpper === "number");
  assert.ok((report.validBootstrapSamples || 0) > 0);
});

test("target action tie uses lexical order for deterministic choice", () => {
  const action = __internal.chooseTargetAction(
    ["read_aloud", "qa_prompt"],
    { read_aloud: 0.7, qa_prompt: 0.7 }
  );
  assert.equal(action, "qa_prompt");
});

