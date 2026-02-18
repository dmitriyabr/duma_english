import assert from "node:assert/strict";
import test from "node:test";
import { transferRemediationQueueDashboardSchema } from "./transferRemediationQueueDashboard";

test("transfer remediation queue dashboard schema accepts valid payload", () => {
  const parsed = transferRemediationQueueDashboardSchema.safeParse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    protocolVersion: "transfer-remediation-queue-v1",
    windowDays: 30,
    totalQueueItems: 12,
    pendingCount: 4,
    scheduledCount: 1,
    completedCount: 7,
    overdueCount: 2,
    completedOnTimeCount: 5,
    slaBreachCount: 4,
    slaOnTimeCompletionRate: 0.714286,
    recoveryResolvedCount: 4,
    recoveryRate: 0.571429,
    medianResolutionLatencyHours: 26.5,
    statusBreakdown: [
      { key: "completed", count: 7 },
      { key: "pending", count: 4 },
      { key: "scheduled", count: 1 },
    ],
    reasonBreakdown: [
      { key: "transfer_fail_validated", count: 6 },
      { key: "inconclusive_control_missing", count: 6 },
    ],
  });
  assert.equal(parsed.success, true);
});
