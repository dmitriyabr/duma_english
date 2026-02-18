import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRetentionCohortProbes } from "./retentionCohortReport";

test("summarizeRetentionCohortProbes builds window and cohort metrics", () => {
  const report = summarizeRetentionCohortProbes({
    now: new Date("2026-02-18T00:00:00.000Z"),
    windowDays: 90,
    totalEvidenceRows: 14,
    probes: [
      {
        studentId: "s1",
        nodeId: "n1",
        stage: "A2",
        domain: "grammar",
        windowDays: 7,
        anchorAt: new Date("2026-01-01T00:00:00.000Z"),
        dueAt: new Date("2026-01-08T00:00:00.000Z"),
        windowEndAt: new Date("2026-01-29T00:00:00.000Z"),
        anchorScore: 0.82,
        followUpAt: new Date("2026-01-09T00:00:00.000Z"),
        followUpScore: 0.8,
        status: "passed",
      },
      {
        studentId: "s1",
        nodeId: "n2",
        stage: "A2",
        domain: "grammar",
        windowDays: 7,
        anchorAt: new Date("2026-01-03T00:00:00.000Z"),
        dueAt: new Date("2026-01-10T00:00:00.000Z"),
        windowEndAt: new Date("2026-01-31T00:00:00.000Z"),
        anchorScore: 0.76,
        followUpAt: new Date("2026-01-12T00:00:00.000Z"),
        followUpScore: 0.64,
        status: "failed",
      },
      {
        studentId: "s2",
        nodeId: "n3",
        stage: "B1",
        domain: "vocab",
        windowDays: 30,
        anchorAt: new Date("2025-11-30T00:00:00.000Z"),
        dueAt: new Date("2025-12-30T00:00:00.000Z"),
        windowEndAt: new Date("2026-01-20T00:00:00.000Z"),
        anchorScore: 0.79,
        followUpAt: null,
        followUpScore: null,
        status: "missed_follow_up",
      },
      {
        studentId: "s2",
        nodeId: "n4",
        stage: "B1",
        domain: "vocab",
        windowDays: 90,
        anchorAt: new Date("2025-11-20T00:00:00.000Z"),
        dueAt: new Date("2026-02-18T00:00:00.000Z"),
        windowEndAt: new Date("2026-03-11T00:00:00.000Z"),
        anchorScore: 0.85,
        followUpAt: null,
        followUpScore: null,
        status: "pending_follow_up",
      },
    ],
  });

  assert.equal(report.totalDueProbeCount, 4);
  assert.equal(report.totalPendingProbeCount, 1);
  assert.equal(report.totalEvaluatedProbeCount, 2);
  assert.equal(report.totalPassedCount, 1);
  assert.equal(report.totalFailedCount, 1);
  assert.equal(report.totalMissedFollowUpCount, 1);
  assert.equal(report.overallPassRate, 0.5);

  const window7 = report.windows.find((row) => row.windowDays === 7);
  assert.ok(window7);
  assert.equal(window7!.dueProbeCount, 2);
  assert.equal(window7!.evaluatedProbeCount, 2);
  assert.equal(window7!.passRate, 0.5);

  const cohort = report.cohorts.find(
    (row) => row.windowDays === 7 && row.stage === "A2" && row.domain === "grammar",
  );
  assert.ok(cohort);
  assert.equal(cohort!.dueProbeCount, 2);
  assert.equal(cohort!.uniqueStudents, 1);
  assert.equal(cohort!.uniqueNodes, 2);
});
