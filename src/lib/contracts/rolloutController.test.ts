import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLLOUT_CONTROLLER_VERSION,
  rolloutStateSchema,
  rolloutControllerLogEntrySchema,
  ROLLOUT_PHASES,
  ROLLOUT_DECISIONS,
} from "./rolloutController";

test("rollout state schema accepts valid payload", () => {
  const parsed = rolloutStateSchema.parse({
    policyVersion: "policy-hybrid-guardrailed-v1",
    phase: "shadow_only",
    updatedAt: "2026-02-20T15:00:00.000Z",
    reason: "default",
  });
  assert.equal(parsed.phase, "shadow_only");
  assert.equal(parsed.policyVersion, "policy-hybrid-guardrailed-v1");
});

test("rollout log entry schema accepts valid payload", () => {
  const parsed = rolloutControllerLogEntrySchema.parse({
    timestamp: "2026-02-20T15:00:00.000Z",
    contractVersion: ROLLOUT_CONTROLLER_VERSION,
    policyVersion: "policy-hybrid-guardrailed-v1",
    phase: "ramp_5",
    decision: "hold",
    reason: "stop_loss_ok_hold",
    metricsSnapshot: {
      shadowHighRiskPer1k: 2.5,
      retentionPassRate: 0.72,
      transferPassRate: 0.65,
      retentionSampleSize: 50,
      transferSampleSize: 10,
    },
  });
  assert.equal(parsed.decision, "hold");
  assert.equal(parsed.metricsSnapshot?.retentionPassRate, 0.72);
});

test("ROLLOUT_PHASES includes rolled_back", () => {
  assert.ok(ROLLOUT_PHASES.includes("rolled_back"));
  assert.ok(ROLLOUT_PHASES.includes("shadow_only"));
});

test("ROLLOUT_DECISIONS includes rollback", () => {
  assert.ok(ROLLOUT_DECISIONS.includes("rollback"));
  assert.ok(ROLLOUT_DECISIONS.includes("hold"));
});
