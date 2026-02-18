import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTransferRemediationQueueRows } from "./transferRemediationQueueDashboard";

test("transfer remediation queue summary computes SLA and recovery metrics", () => {
  const now = new Date("2026-02-18T12:00:00Z");
  const report = summarizeTransferRemediationQueueRows({
    now,
    windowDays: 30,
    rows: [
      {
        status: "pending",
        reasonCode: "transfer_fail_validated",
        createdAt: new Date("2026-02-17T10:00:00Z"),
        dueAt: new Date("2026-02-18T10:00:00Z"),
        completedAt: null,
        metadataJson: {},
      },
      {
        status: "completed",
        reasonCode: "transfer_fail_validated",
        createdAt: new Date("2026-02-16T10:00:00Z"),
        dueAt: new Date("2026-02-17T10:00:00Z"),
        completedAt: new Date("2026-02-17T08:00:00Z"),
        metadataJson: {
          transferRemediationQueue: {
            recoveryResolved: true,
          },
        },
      },
      {
        status: "completed",
        reasonCode: "inconclusive_control_missing",
        createdAt: new Date("2026-02-16T12:00:00Z"),
        dueAt: new Date("2026-02-17T12:00:00Z"),
        completedAt: new Date("2026-02-17T16:00:00Z"),
        metadataJson: {
          transferRemediationQueue: {
            recoveryResolved: false,
          },
        },
      },
    ],
  });

  assert.equal(report.totalQueueItems, 3);
  assert.equal(report.pendingCount, 1);
  assert.equal(report.completedCount, 2);
  assert.equal(report.overdueCount, 1);
  assert.equal(report.completedOnTimeCount, 1);
  assert.equal(report.slaBreachCount, 2);
  assert.equal(report.slaOnTimeCompletionRate, 0.5);
  assert.equal(report.recoveryResolvedCount, 1);
  assert.equal(report.recoveryRate, 0.5);
  assert.ok(typeof report.medianResolutionLatencyHours === "number");
});
