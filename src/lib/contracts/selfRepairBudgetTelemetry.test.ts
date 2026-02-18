import assert from "node:assert/strict";
import test from "node:test";
import { selfRepairBudgetTelemetryReportSchema } from "./selfRepairBudgetTelemetry";

test("self-repair budget telemetry schema accepts valid payload", () => {
  const parsed = selfRepairBudgetTelemetryReportSchema.safeParse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    guardrailsVersion: "self-repair-budget-guardrails-v1",
    windowDays: 30,
    totalCycles: 28,
    budgetExhaustedCount: 4,
    budgetExhaustedRate: 0.142857,
    escalatedCount: 4,
    escalationQueueOpenCount: 2,
    escalationQueueCompletedCount: 2,
    averageProjectedImmediateShare: 0.213,
    maxProjectedImmediateShare: 0.47,
    averageLoopsUsedPerSkillSession: 1.3,
    reasons: [
      { reason: "per_skill_loop_cap", count: 3 },
      { reason: "session_time_share_cap", count: 2 },
    ],
  });

  assert.equal(parsed.success, true);
});
