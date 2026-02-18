import test from "node:test";
import assert from "node:assert/strict";
import { memorySchedulerDashboardSchema } from "./memorySchedulerDashboard";

test("memory scheduler dashboard schema accepts valid report", () => {
  const parsed = memorySchedulerDashboardSchema.parse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    schedulerVersion: "memory-scheduler-v1",
    windowDays: 30,
    totalQueueItems: 24,
    openCount: 10,
    overdueOpenCount: 3,
    dueMissCount: 4,
    dueMissRate: 0.166667,
    medianResolutionLatencyHours: 6.5,
    medianOpenAgeHours: 9.75,
    fragileOpenCount: 5,
    portfolio: [
      {
        portfolio: "fresh",
        openCount: 3,
        overdueOpenCount: 1,
        completedCount: 8,
        dueMissCount: 2,
        medianResolutionLatencyHours: 7,
        medianOpenAgeHours: 8,
      },
      {
        portfolio: "review",
        openCount: 5,
        overdueOpenCount: 2,
        completedCount: 5,
        dueMissCount: 1,
        medianResolutionLatencyHours: 5,
        medianOpenAgeHours: 11,
      },
      {
        portfolio: "transfer",
        openCount: 2,
        overdueOpenCount: 0,
        completedCount: 1,
        dueMissCount: 1,
        medianResolutionLatencyHours: 18,
        medianOpenAgeHours: 4,
      },
    ],
    reasonBreakdown: [
      { key: "fresh_consolidation", count: 10 },
      { key: "memory_overdue", count: 6 },
    ],
  });

  assert.equal(parsed.schedulerVersion, "memory-scheduler-v1");
  assert.equal(parsed.portfolio.length, 3);
});

