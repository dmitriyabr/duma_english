import assert from "node:assert/strict";
import test from "node:test";
import { opeReportSchema } from "./opeReport";

test("ope report schema accepts valid payload", () => {
  const parsed = opeReportSchema.safeParse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    policyVersion: "ope-snips-v1",
    windowDays: 90,
    totalRows: 300,
    completeRows: 240,
    excludedRows: 60,
    incompleteRate: 0.2,
    bootstrapSamples: 400,
    validBootstrapSamples: 391,
    exclusionReasons: [
      { key: "missing_task_score", count: 30 },
      { key: "invalid_propensity", count: 20 },
    ],
    policyVersions: [
      { key: "policy-rules-v1", count: 300 },
    ],
    metrics: {
      baselineValue: 0.61,
      targetPolicyValue: 0.66,
      lift: 0.05,
      ciLower: 0.01,
      ciUpper: 0.08,
      effectiveSampleSize: 170.3,
      targetMatchRate: 0.43,
    },
  });

  assert.equal(parsed.success, true);
});
