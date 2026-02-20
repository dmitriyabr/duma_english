import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTENING_TRANSFER_RETENTION_REPORT_VERSION,
  listeningTransferRetentionReportSchema,
} from "./listeningTransferRetentionReport";

test("listening transfer retention report schema accepts valid payload", () => {
  const parsed = listeningTransferRetentionReportSchema.parse({
    generatedAt: "2026-02-20T12:00:00.000Z",
    contractVersion: LISTENING_TRANSFER_RETENTION_REPORT_VERSION,
    windowDays: 30,
    totalAttempts: 200,
    listeningAttempts: 18,
    scoredListeningAttempts: 18,
    avgTaskScore: 68.5,
    passRate: 0.666667,
    transfer: {
      evaluableCount: 4,
      passCount: 3,
      failCount: 1,
      passRate: 0.75,
    },
    retention: {
      window7dCount: 12,
      window7dPassRate: 0.833333,
      window30dCount: 8,
      window30dPassRate: 0.75,
    },
    byStage: [
      { stage: "A2", attempts: 10, avgTaskScore: 66, passRate: 0.6 },
      { stage: "B1", attempts: 8, avgTaskScore: 71, passRate: 0.75 },
    ],
  });

  assert.equal(parsed.contractVersion, LISTENING_TRANSFER_RETENTION_REPORT_VERSION);
  assert.equal(parsed.listeningAttempts, 18);
  assert.equal(parsed.transfer.evaluableCount, 4);
  assert.equal(parsed.retention.window7dCount, 12);
});
