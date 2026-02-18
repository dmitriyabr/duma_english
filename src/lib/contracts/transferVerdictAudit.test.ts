import assert from "node:assert/strict";
import test from "node:test";
import {
  transferVerdictAuditReportSchema,
} from "./transferVerdictAudit";

test("transfer verdict audit report schema accepts valid payload", () => {
  const parsed = transferVerdictAuditReportSchema.safeParse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    protocolVersion: "transfer-difficulty-match-v1",
    windowDays: 30,
    totalOodSpecs: 10,
    evaluatedOodSpecs: 8,
    pendingOodSpecs: 2,
    transferPassCount: 3,
    candidateTransferFailCount: 4,
    validatedTransferFailCount: 2,
    unvalidatedTransferFailCount: 2,
    inconclusiveCount: 3,
    protocolViolationCount: 0,
    matchedControlPassRate: 0.5,
    verdictBreakdown: [
      { verdict: "transfer_pass", count: 3 },
      { verdict: "transfer_fail_validated", count: 2 },
    ],
    axisBreakdown: [
      { axisTag: "topic", count: 4 },
      { axisTag: "register", count: 2 },
    ],
  });

  assert.equal(parsed.success, true);
});
