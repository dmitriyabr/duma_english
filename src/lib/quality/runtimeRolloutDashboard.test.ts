import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRuntimeRolloutDashboard } from "./runtimeRolloutDashboard";

test("runtime rollout summary computes leakage, memory hit-rate, and blocker reasons", () => {
  const report = summarizeRuntimeRolloutDashboard({
    now: new Date("2026-02-23T00:00:00.000Z"),
    windowDays: 30,
    listeningRows: [
      {
        specJson: { listening: { assetId: "task_1" } },
        task: {
          prompt: "Listen to the audio and answer.\nQuestion: Why?",
          metaJson: { listeningScript: "Ben missed the bus and called his teacher." },
        },
      },
      {
        specJson: { listening: { assetId: "task_2" } },
        task: {
          prompt: "Audio: Ben missed the bus and called his teacher.\nQuestion: Why?",
          metaJson: { listeningScript: "Ben missed the bus and called his teacher." },
        },
      },
    ],
    plannerRows: [
      {
        utilityJson: {
          memoryQueueDue: { dueCount: 3 },
          memoryQueueHits: 2,
          memoryDueOverrideApplied: false,
        },
      },
      {
        utilityJson: {
          memoryQueueDue: { dueCount: 2 },
          memoryQueueHits: 0,
          memoryDueOverrideApplied: true,
        },
      },
    ],
    completedAttempts: 4,
    causalRows: [
      { attemptId: "a1", topLabel: "rule_confusion" },
      { attemptId: "a2", topLabel: "retrieval_failure" },
    ],
    promotionRows: [
      {
        blockedByNodes: ["node_1"],
        reasonsJson: {
          blockedBundles: [{ reason: "retention_gate_not_passed" }],
        },
      },
    ],
  });

  assert.equal(report.listeningAuthenticity.promptLeakCount, 1);
  assert.equal(report.memoryRuntime.backlogDecisions, 2);
  assert.equal(report.memoryRuntime.backlogHitDecisions, 1);
  assert.equal(report.memoryRuntime.dueOverrideCount, 1);
  assert.equal(report.causalCoach.withCausalDiagnosis, 2);
  assert.equal(report.promotionBlocks.blockedAudits, 1);
  assert.equal(report.promotionBlocks.reasons[0]?.reason, "retention_gate_not_passed");
});
