import test from "node:test";
import assert from "node:assert/strict";
import { retentionCohortReportSchema } from "./retentionCohortReport";

test("retention cohort report schema accepts valid payload", () => {
  const parsed = retentionCohortReportSchema.parse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    contractVersion: "retention-cohort-v1",
    protocolVersion: "retention-probes-v1",
    graceDays: 21,
    windowDays: 90,
    totalEvidenceRows: 340,
    totalDueProbeCount: 120,
    totalPendingProbeCount: 12,
    totalEvaluatedProbeCount: 88,
    totalPassedCount: 61,
    totalFailedCount: 27,
    totalMissedFollowUpCount: 20,
    overallPassRate: 0.693182,
    overallCompletionRate: 0.733333,
    windows: [
      {
        windowDays: 7,
        dueProbeCount: 45,
        evaluatedProbeCount: 40,
        passedCount: 30,
        failedCount: 10,
        missedFollowUpCount: 2,
        passRate: 0.75,
        completionRate: 0.888889,
      },
      {
        windowDays: 30,
        dueProbeCount: 40,
        evaluatedProbeCount: 30,
        passedCount: 19,
        failedCount: 11,
        missedFollowUpCount: 7,
        passRate: 0.633333,
        completionRate: 0.75,
      },
      {
        windowDays: 90,
        dueProbeCount: 35,
        evaluatedProbeCount: 18,
        passedCount: 12,
        failedCount: 6,
        missedFollowUpCount: 11,
        passRate: 0.666667,
        completionRate: 0.514286,
      },
    ],
    cohorts: [
      {
        windowDays: 30,
        stage: "B1",
        domain: "grammar",
        dueProbeCount: 12,
        pendingProbeCount: 1,
        evaluatedProbeCount: 9,
        passedCount: 6,
        failedCount: 3,
        missedFollowUpCount: 2,
        passRate: 0.666667,
        completionRate: 0.75,
        medianFollowUpLagDays: 31.4,
        uniqueStudents: 5,
        uniqueNodes: 7,
      },
    ],
  });

  assert.equal(parsed.contractVersion, "retention-cohort-v1");
  assert.equal(parsed.cohorts[0]?.stage, "B1");
});
