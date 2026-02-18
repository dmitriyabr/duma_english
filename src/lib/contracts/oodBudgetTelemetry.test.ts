import assert from "node:assert/strict";
import test from "node:test";
import { oodBudgetTelemetryReportSchema } from "./oodBudgetTelemetry";

test("ood budget telemetry report schema accepts valid payload", () => {
  const parsed = oodBudgetTelemetryReportSchema.safeParse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    controllerVersion: "ood-budget-controller-v1",
    targetBudgetBand: {
      minRate: 0.1,
      maxRate: 0.2,
    },
    windowDays: 30,
    totalLearners: 1,
    summary: {
      totalTasks: 20,
      totalOodInjectedTasks: 3,
      realizedOodRate: 0.15,
      learnersOutsideBudgetBand: 0,
    },
    learners: [
      {
        studentId: "stu_1",
        totalTasks: 20,
        oodInjectedTasks: 3,
        realizedOodRate: 0.15,
        averageBudgetRate: 0.14,
        averageBudgetInterval: 7,
        milestonePressureTasks: 4,
        overfitRiskTasks: 2,
        evaluatedOodCount: 3,
        oodPassCount: 2,
        oodFailCount: 1,
        outsideBudgetBand: false,
      },
    ],
  });

  assert.equal(parsed.success, true);
});
