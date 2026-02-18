import assert from "node:assert/strict";
import test from "node:test";
import { __internal } from "./selfRepairImmediateLoopReport";

test("self-repair report summarizes completion and latency metrics", () => {
  const report = __internal.summarizeRows({
    now: new Date("2026-02-18T00:00:00Z"),
    windowDays: 30,
    rows: [
      {
        status: "pending_immediate_retry",
        causeLabel: "rule_confusion",
        sourceAttempt: { completedAt: new Date("2026-02-17T10:00:00Z") },
        immediateAttempt: null,
      },
      {
        status: "pending_delayed_verification",
        causeLabel: "retrieval_failure",
        sourceAttempt: { completedAt: new Date("2026-02-17T11:00:00Z") },
        immediateAttempt: { completedAt: new Date("2026-02-17T11:08:00Z") },
      },
      {
        status: "completed",
        causeLabel: null,
        sourceAttempt: { completedAt: new Date("2026-02-17T12:00:00Z") },
        immediateAttempt: { completedAt: new Date("2026-02-17T12:20:00Z") },
      },
    ],
  });

  assert.equal(report.totalCycles, 3);
  assert.equal(report.immediateCompletedCount, 2);
  assert.equal(report.immediateCompletionRate, 0.666667);
  assert.equal(report.pendingImmediateCount, 1);
  assert.equal(report.pendingDelayedCount, 1);
  assert.equal(report.completedCount, 1);
  assert.equal(report.medianImmediateLatencyMinutes, 14);
  assert.equal(report.causeLabels[0]?.count, 1);
});
