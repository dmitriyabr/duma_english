import assert from "node:assert/strict";
import test from "node:test";
import { summarizeL1InterferenceTemplateMappings } from "./l1InterferenceTemplateReport";

test("l1 template report summarizes cause-to-template mapping stats", () => {
  const report = summarizeL1InterferenceTemplateMappings({
    windowDays: 30,
    now: new Date("2026-02-18T07:10:00.000Z"),
    rows: [
      {
        utilityJson: {
          causalRemediation: {
            applied: true,
            topCauseLabel: "l1_interference",
            chosenTemplateKey: "l1_pragmatic_register_switch_9_11",
            chosenTemplateTitle: "Register-switch communication drill",
            chosenDomain: "lo",
            interferencePrior: {
              ageBand: "9-11",
            },
          },
        },
      },
      {
        utilityJson: {
          causalRemediation: {
            applied: true,
            topCauseLabel: "l1_interference",
            chosenTemplateKey: null,
            chosenTemplateTitle: null,
            chosenDomain: "grammar",
            interferencePrior: {
              ageBand: "12-14",
            },
          },
        },
      },
      {
        utilityJson: {
          causalRemediation: {
            applied: true,
            topCauseLabel: "rule_confusion",
            chosenTemplateKey: null,
            chosenTemplateTitle: null,
            chosenDomain: "grammar",
            interferencePrior: {
              ageBand: "9-11",
            },
          },
        },
      },
    ],
  });

  assert.equal(report.totalDecisionLogs, 3);
  assert.equal(report.causalRemediationEvaluatedCount, 3);
  assert.equal(report.l1TopCauseCount, 2);
  assert.equal(report.templatedL1Count, 1);
  assert.equal(report.missingTemplateForL1Count, 1);
  assert.equal(report.templatedL1Rate, 0.5);
  assert.equal(report.templateBreakdown[0]?.templateKey, "l1_pragmatic_register_switch_9_11");
  assert.equal(report.causeTemplateMappings[0]?.causeLabel, "l1_interference");
});

test("l1 template report handles missing causal payload", () => {
  const report = summarizeL1InterferenceTemplateMappings({
    windowDays: 7,
    rows: [{ utilityJson: {} }, { utilityJson: null }],
  });

  assert.equal(report.totalDecisionLogs, 2);
  assert.equal(report.causalRemediationEvaluatedCount, 0);
  assert.equal(report.l1TopCauseCount, 0);
  assert.equal(report.templatedL1Rate, null);
});
