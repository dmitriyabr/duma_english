import assert from "node:assert/strict";
import test from "node:test";
import {
  l1InterferenceTemplateReportSchema,
} from "./l1InterferenceTemplateReport";

test("l1 interference template report contract accepts valid payload", () => {
  const parsed = l1InterferenceTemplateReportSchema.parse({
    generatedAt: new Date("2026-02-18T07:00:00.000Z").toISOString(),
    priorVersion: "l1-interference-prior-v1",
    windowDays: 30,
    totalDecisionLogs: 12,
    causalRemediationEvaluatedCount: 10,
    l1TopCauseCount: 4,
    templatedL1Count: 3,
    missingTemplateForL1Count: 1,
    templatedL1Rate: 0.75,
    ageBandBreakdown: [
      { key: "9-11", count: 2 },
      { key: "12-14", count: 1 },
    ],
    domainBreakdown: [{ key: "lo", count: 3 }],
    templateBreakdown: [
      {
        templateKey: "l1_pragmatic_register_switch_9_11",
        templateTitle: "Register-switch communication drill",
        count: 2,
      },
    ],
    causeTemplateMappings: [
      {
        causeLabel: "l1_interference",
        templateKey: "l1_pragmatic_register_switch_9_11",
        count: 2,
      },
    ],
  });

  assert.equal(parsed.priorVersion, "l1-interference-prior-v1");
  assert.equal(parsed.templatedL1Count, 3);
});

test("l1 interference template report contract rejects invalid rates", () => {
  const failure = l1InterferenceTemplateReportSchema.safeParse({
    generatedAt: new Date("2026-02-18T07:00:00.000Z").toISOString(),
    priorVersion: "l1-interference-prior-v1",
    windowDays: 30,
    totalDecisionLogs: 1,
    causalRemediationEvaluatedCount: 1,
    l1TopCauseCount: 1,
    templatedL1Count: 1,
    missingTemplateForL1Count: 0,
    templatedL1Rate: 1.2,
    ageBandBreakdown: [],
    domainBreakdown: [],
    templateBreakdown: [],
    causeTemplateMappings: [],
  });

  assert.equal(failure.success, false);
});
