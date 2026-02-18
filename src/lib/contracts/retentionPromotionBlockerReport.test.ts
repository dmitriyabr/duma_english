import test from "node:test";
import assert from "node:assert/strict";
import { retentionPromotionBlockerReportSchema } from "./retentionPromotionBlockerReport";

test("retentionPromotionBlockerReportSchema accepts valid payload", () => {
  const parsed = retentionPromotionBlockerReportSchema.parse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    gateVersion: "retention-promotion-gate-v1",
    windowDays: 30,
    totalAudits: 20,
    promotedCount: 7,
    blockedCount: 13,
    blockedByRetentionCount: 6,
    blockedByRetentionRate: 0.3,
    highStakesAuditCount: 9,
    highStakesRetentionBlockedCount: 6,
    highStakesRetentionBlockedRate: 0.666667,
    missingRetentionGateContextCount: 2,
    reasonBreakdown: [{ key: "retention_30d_below_threshold", count: 4 }],
    transitionBreakdown: [
      {
        fromStage: "A2",
        toStage: "B1",
        count: 5,
        blockedByRetentionCount: 3,
      },
    ],
  });

  assert.equal(parsed.gateVersion, "retention-promotion-gate-v1");
  assert.equal(parsed.transitionBreakdown.length, 1);
});
