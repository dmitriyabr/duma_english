import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRetentionPromotionGateFromRows } from "./promotionGate";

const now = new Date("2026-02-18T00:00:00.000Z");

function rowsForWindow(anchorDaysAgo: number, followUpDaysAgo: number, pass = true) {
  return [
    {
      studentId: "student-1",
      nodeId: `node-${anchorDaysAgo}`,
      createdAt: new Date(now.getTime() - anchorDaysAgo * 24 * 60 * 60 * 1000),
      score: 0.9,
    },
    {
      studentId: "student-1",
      nodeId: `node-${anchorDaysAgo}`,
      createdAt: new Date(now.getTime() - followUpDaysAgo * 24 * 60 * 60 * 1000),
      score: pass ? 0.85 : 0.45,
    },
  ];
}

test("non-high-stakes targets do not hard-block promotion", () => {
  const result = evaluateRetentionPromotionGateFromRows({
    targetStage: "A2",
    rows: [],
    now,
  });

  assert.equal(result.required, false);
  assert.equal(result.passed, true);
  assert.equal(result.blockerReasons.length, 0);
});

test("high-stakes targets block on insufficient samples", () => {
  const result = evaluateRetentionPromotionGateFromRows({
    targetStage: "B1",
    rows: rowsForWindow(40, 9, true),
    now,
  });

  assert.equal(result.required, true);
  assert.equal(result.passed, false);
  assert.ok(result.blockerReasons.includes("retention_7d_insufficient_sample"));
  assert.ok(result.blockerReasons.includes("retention_30d_insufficient_sample"));
});

test("high-stakes targets pass when all 7/30/90 windows clear threshold", () => {
  const rows = [
    ...rowsForWindow(20, 10, true),
    ...rowsForWindow(21, 12, true),
    ...rowsForWindow(22, 13, true),
    ...rowsForWindow(70, 35, true),
    ...rowsForWindow(72, 40, true),
    ...rowsForWindow(170, 70, true),
  ];

  const result = evaluateRetentionPromotionGateFromRows({
    targetStage: "B2",
    rows,
    now,
  });

  assert.equal(result.required, true);
  assert.equal(result.passed, true);
  assert.equal(result.blockerReasons.length, 0);
  for (const window of result.windows) {
    assert.equal(window.passed, true);
  }
});

test("high-stakes targets block when one window falls below threshold", () => {
  const rows = [
    ...rowsForWindow(20, 10, false),
    ...rowsForWindow(21, 12, false),
    ...rowsForWindow(22, 13, false),
    ...rowsForWindow(70, 35, true),
    ...rowsForWindow(72, 40, true),
    ...rowsForWindow(170, 70, true),
  ];

  const result = evaluateRetentionPromotionGateFromRows({
    targetStage: "C1",
    rows,
    now,
  });

  assert.equal(result.required, true);
  assert.equal(result.passed, false);
  assert.ok(result.blockerReasons.includes("retention_7d_below_threshold"));
});
