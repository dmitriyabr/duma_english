import assert from "node:assert/strict";
import test from "node:test";
import { selfRepairDelayedVerificationReportSchema } from "./selfRepairDelayedVerificationReport";

test("self-repair delayed verification report schema validates payload", () => {
  const parsed = selfRepairDelayedVerificationReportSchema.parse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    protocolVersion: "self-repair-delayed-verification-v1",
    windowDays: 30,
    staleThresholdHours: 72,
    totalCycles: 5,
    pendingDelayedCount: 2,
    delayedAttemptLinkedCount: 3,
    validVerificationCount: 2,
    invalidVerificationCount: 2,
    invalidDuplicateTaskFamilyCount: 1,
    invalidDuplicatePromptCount: 1,
    missingDelayedVerificationCount: 1,
    invalidRate: 0.4,
    reasonCounts: [{ reason: "duplicate_task_family", count: 1 }],
  });

  assert.equal(parsed.totalCycles, 5);
  assert.equal(parsed.protocolVersion, "self-repair-delayed-verification-v1");
});
