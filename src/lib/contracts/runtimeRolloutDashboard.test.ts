import test from "node:test";
import assert from "node:assert/strict";
import { runtimeRolloutDashboardSchema } from "./runtimeRolloutDashboard";

test("runtime rollout dashboard schema accepts valid payload", () => {
  const parsed = runtimeRolloutDashboardSchema.parse({
    generatedAt: "2026-02-23T00:00:00.000Z",
    windowDays: 30,
    flags: {
      listening_runtime_v2: true,
      retention_gate_v2: true,
      memory_runtime_v1: true,
      policy_gate_v1: true,
      shadow_model_v2: false,
    },
    listeningAuthenticity: {
      tasksIssued: 10,
      withAudioPayload: 10,
      promptLeakCount: 0,
      scriptLeakRate: 0,
    },
    memoryRuntime: {
      decisions: 12,
      backlogDecisions: 8,
      backlogHitDecisions: 7,
      backlogHitRate: 0.875,
      dueOverrideCount: 2,
    },
    causalCoach: {
      completedAttempts: 20,
      withCausalDiagnosis: 16,
      exposureRate: 0.8,
      topLabels: [{ label: "rule_confusion", count: 6 }],
    },
    promotionBlocks: {
      audits: 5,
      blockedAudits: 3,
      reasons: [{ reason: "retention_gate_not_passed", count: 2 }],
    },
  });

  assert.equal(parsed.listeningAuthenticity.promptLeakCount, 0);
  assert.equal(parsed.flags.shadow_model_v2, false);
});
