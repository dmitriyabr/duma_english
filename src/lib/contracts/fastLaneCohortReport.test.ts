import assert from "node:assert/strict";
import test from "node:test";
import { fastLaneCohortReportSchema } from "./fastLaneCohortReport";

test("fast lane cohort report schema accepts valid payload", () => {
  const parsed = fastLaneCohortReportSchema.safeParse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    protocolVersion: "fast-lane-progression-v1",
    windowDays: 30,
    totalLearners: 42,
    totalTasks: 720,
    cohorts: [
      {
        cohort: "fast_lane",
        learners: 18,
        tasks: 320,
        tasksPerLearnerPerDay: 0.5926,
        medianInterTaskHours: 26.2,
        diagnosticTaskRate: 0.08,
        oodInjectionRate: 0.12,
        transferFailRate: 0.09,
        needsRetryRate: 0.04,
      },
      {
        cohort: "standard",
        learners: 24,
        tasks: 400,
        tasksPerLearnerPerDay: 0.5555,
        medianInterTaskHours: 31.8,
        diagnosticTaskRate: 0.17,
        oodInjectionRate: 0.16,
        transferFailRate: 0.11,
        needsRetryRate: 0.07,
      },
    ],
    deltas: {
      velocityLiftVsStandard: 0.0667,
      diagnosticRateDelta: -0.09,
      oodInjectionRateDelta: -0.04,
      transferFailRateDelta: -0.02,
      needsRetryRateDelta: -0.03,
    },
  });

  assert.equal(parsed.success, true);
});
