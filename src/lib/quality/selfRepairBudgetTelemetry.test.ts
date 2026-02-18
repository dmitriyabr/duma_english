import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSelfRepairBudgetTelemetry } from "./selfRepairBudgetTelemetry";

test("summarizeSelfRepairBudgetTelemetry reports exhaustion and escalation counters", () => {
  const report = summarizeSelfRepairBudgetTelemetry({
    windowDays: 30,
    now: new Date("2026-02-18T00:00:00.000Z"),
    cycleRows: [
      {
        status: "pending_immediate_retry",
        metadataJson: {
          budgetGuardrails: {
            exhausted: false,
            loopsUsedForSkillSession: 1,
            projectedImmediateShare: 0.18,
            reasons: [],
          },
        },
      },
      {
        status: "escalated",
        metadataJson: {
          budgetGuardrails: {
            exhausted: true,
            loopsUsedForSkillSession: 2,
            projectedImmediateShare: 0.31,
            reasons: ["per_skill_loop_cap"],
          },
        },
      },
    ],
    escalationQueueRows: [
      { status: "pending" },
      { status: "completed" },
    ],
  });

  assert.equal(report.totalCycles, 2);
  assert.equal(report.budgetExhaustedCount, 1);
  assert.equal(report.escalatedCount, 1);
  assert.equal(report.escalationQueueOpenCount, 1);
  assert.equal(report.escalationQueueCompletedCount, 1);
  assert.equal(report.averageProjectedImmediateShare, 0.245);
  assert.equal(report.reasons[0]?.reason, "per_skill_loop_cap");
});
