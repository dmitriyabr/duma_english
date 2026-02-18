import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRetentionPromotionAudits } from "./retentionPromotionBlockerReport";

test("summarizeRetentionPromotionAudits reports retention blocker rates", () => {
  const now = new Date("2026-02-18T00:00:00.000Z");
  const report = summarizeRetentionPromotionAudits({
    now,
    windowDays: 30,
    rows: [
      {
        fromStage: "A2",
        targetStage: "B1",
        promoted: false,
        reasonsJson: {
          retentionGate: {
            required: true,
            passed: false,
            blockerReasons: ["retention_7d_below_threshold"],
          },
          blockedBundles: [{ reason: "retention_gate_not_passed" }],
        },
      },
      {
        fromStage: "A2",
        targetStage: "B1",
        promoted: false,
        reasonsJson: {
          stressGate: {
            required: true,
            passed: false,
          },
          blockedBundles: [{ reason: "stress_gate_not_passed" }],
        },
      },
      {
        fromStage: "B1",
        targetStage: "B2",
        promoted: true,
        reasonsJson: {
          retentionGate: {
            required: true,
            passed: true,
            blockerReasons: [],
          },
        },
      },
    ],
  });

  assert.equal(report.totalAudits, 3);
  assert.equal(report.promotedCount, 1);
  assert.equal(report.blockedCount, 2);
  assert.equal(report.blockedByRetentionCount, 1);
  assert.equal(report.highStakesAuditCount, 3);
  assert.equal(report.missingRetentionGateContextCount, 1);
  assert.equal(report.reasonBreakdown[0]?.key, "retention_7d_below_threshold");

  const a2ToB1 = report.transitionBreakdown.find(
    (row) => row.fromStage === "A2" && row.toStage === "B1",
  );
  assert.equal(a2ToB1?.count, 2);
  assert.equal(a2ToB1?.blockedByRetentionCount, 1);
});
