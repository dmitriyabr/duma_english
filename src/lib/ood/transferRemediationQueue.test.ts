import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldEnqueueTransferRemediation,
  shouldResolveTransferRemediation,
  transferRemediationDueAt,
} from "./transferRemediationQueue";

test("enqueue trigger verdicts include validated fail and inconclusive control missing", () => {
  assert.equal(shouldEnqueueTransferRemediation("transfer_fail_validated"), true);
  assert.equal(shouldEnqueueTransferRemediation("inconclusive_control_missing"), true);
  assert.equal(shouldEnqueueTransferRemediation("transfer_pass"), false);
  assert.equal(shouldEnqueueTransferRemediation("inconclusive_missing_ood_score"), false);
});

test("resolve trigger verdict includes transfer pass only", () => {
  assert.equal(shouldResolveTransferRemediation("transfer_pass"), true);
  assert.equal(shouldResolveTransferRemediation("transfer_fail_validated"), false);
});

test("transfer remediation dueAt defaults to +72h", () => {
  const now = new Date("2026-02-18T12:00:00Z");
  const due = transferRemediationDueAt(now);
  assert.equal(due.toISOString(), "2026-02-21T12:00:00.000Z");
});
