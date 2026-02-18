import assert from "node:assert/strict";
import test from "node:test";
import { selfRepairImmediateLoopReportSchema } from "./selfRepairImmediateLoopReport";

test("self-repair immediate loop report schema validates expected payload", () => {
  const parsed = selfRepairImmediateLoopReportSchema.parse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    protocolVersion: "self-repair-immediate-v1",
    windowDays: 30,
    totalCycles: 4,
    immediateCompletedCount: 3,
    immediateCompletionRate: 0.75,
    pendingImmediateCount: 1,
    pendingDelayedCount: 2,
    completedCount: 1,
    escalatedCount: 0,
    cancelledCount: 0,
    medianImmediateLatencyMinutes: 12.5,
    causeLabels: [{ causeLabel: "rule_confusion", count: 2 }],
  });

  assert.equal(parsed.totalCycles, 4);
  assert.equal(parsed.protocolVersion, "self-repair-immediate-v1");
});
