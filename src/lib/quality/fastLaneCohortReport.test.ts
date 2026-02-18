import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFastLaneCohorts } from "./fastLaneCohortReport";

test("summarizeFastLaneCohorts builds velocity vs safety deltas", () => {
  const report = summarizeFastLaneCohorts({
    windowDays: 30,
    now: new Date("2026-02-18T00:00:00.000Z"),
    rows: [
      {
        studentId: "stu_fast",
        createdAt: new Date("2026-02-17T00:00:00.000Z"),
        metaJson: {
          fastLane: { eligible: true },
          selectionReasonType: "weakness",
        },
        oodVerdict: "transfer_pass",
        latestAttemptStatus: "completed",
      },
      {
        studentId: "stu_fast",
        createdAt: new Date("2026-02-17T12:00:00.000Z"),
        metaJson: {
          fastLane: { eligible: true },
          selectionReasonType: "weakness",
        },
        oodVerdict: "transfer_pass",
        latestAttemptStatus: "completed",
      },
      {
        studentId: "stu_std",
        createdAt: new Date("2026-02-17T00:00:00.000Z"),
        metaJson: {
          selectionReasonType: "verification",
          causalDisambiguationProbe: { enabled: true },
        },
        oodVerdict: "transfer_fail_validated",
        latestAttemptStatus: "needs_retry",
      },
      {
        studentId: "stu_std",
        createdAt: new Date("2026-02-18T00:00:00.000Z"),
        metaJson: {
          selectionReasonType: "verification",
        },
        oodVerdict: "transfer_pass",
        latestAttemptStatus: "completed",
      },
    ],
  });

  const fastLane = report.cohorts.find((row) => row.cohort === "fast_lane");
  const standard = report.cohorts.find((row) => row.cohort === "standard");

  assert.ok(fastLane);
  assert.ok(standard);

  assert.equal(fastLane?.diagnosticTaskRate, 0);
  assert.equal(standard?.diagnosticTaskRate, 1);
  assert.equal(fastLane?.oodInjectionRate, 1);
  assert.equal(standard?.oodInjectionRate, 1);
  assert.equal(standard?.transferFailRate, 0.5);
  assert.equal(standard?.needsRetryRate, 0.5);
  assert.equal(typeof report.deltas.diagnosticRateDelta, "number");
});
