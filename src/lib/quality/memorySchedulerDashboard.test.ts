import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMemorySchedulerRows } from "./memorySchedulerDashboard";

test("summarizeMemorySchedulerRows computes due-miss and latency metrics", () => {
  const now = new Date("2026-02-18T12:00:00Z");
  const report = summarizeMemorySchedulerRows({
    now,
    windowDays: 30,
    rows: [
      {
        queueType: "memory_fresh",
        status: "pending",
        reasonCode: "fresh_consolidation",
        dueAt: new Date("2026-02-18T09:00:00Z"),
        createdAt: new Date("2026-02-18T06:00:00Z"),
        completedAt: null,
        metadataJson: {
          memoryScheduler: {
            isFragileNode: true,
          },
        },
      },
      {
        queueType: "memory_review",
        status: "completed",
        reasonCode: "memory_overdue",
        dueAt: new Date("2026-02-18T10:00:00Z"),
        createdAt: new Date("2026-02-18T04:00:00Z"),
        completedAt: new Date("2026-02-18T09:30:00Z"),
        metadataJson: {
          memoryScheduler: {
            isFragileNode: false,
          },
        },
      },
      {
        queueType: "transfer_remediation",
        status: "completed",
        reasonCode: "transfer_fail_validated",
        dueAt: new Date("2026-02-18T08:00:00Z"),
        createdAt: new Date("2026-02-18T01:00:00Z"),
        completedAt: new Date("2026-02-18T10:00:00Z"),
        metadataJson: {},
      },
    ],
  });

  assert.equal(report.totalQueueItems, 3);
  assert.equal(report.openCount, 1);
  assert.equal(report.overdueOpenCount, 1);
  assert.equal(report.dueMissCount, 2);
  assert.equal(report.fragileOpenCount, 1);
  assert.equal(report.dueMissRate, 0.666667);
  assert.ok(report.medianResolutionLatencyHours !== null);

  const fresh = report.portfolio.find((row) => row.portfolio === "fresh");
  const review = report.portfolio.find((row) => row.portfolio === "review");
  const transfer = report.portfolio.find((row) => row.portfolio === "transfer");

  assert.equal(fresh?.openCount, 1);
  assert.equal(review?.completedCount, 1);
  assert.equal(transfer?.dueMissCount, 1);
});
