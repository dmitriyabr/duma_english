import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLocalePolicyContextReport } from "./localePolicyContextReport";

test("locale policy context report summarizes localized decision share and uplift", () => {
  const report = summarizeLocalePolicyContextReport({
    windowDays: 30,
    now: new Date("2026-02-18T07:00:00.000Z"),
    decisionRows: [
      {
        id: "dec_1",
        studentId: "stu_1",
        decisionTs: new Date("2026-02-18T06:00:00.000Z"),
        chosenTaskType: "role_play",
        utilityJson: {
          localeProfile: {
            dominantPrimaryTag: "sheng",
            codeSwitchRate: 0.38,
          },
          localeAdaptation: {
            applied: true,
            overrideApplied: true,
            reasonCodes: ["code_switch_high", "sheng_primary_pattern"],
          },
        },
        taskInstance: { taskId: "task_1" },
      },
      {
        id: "dec_2",
        studentId: "stu_2",
        decisionTs: new Date("2026-02-18T05:00:00.000Z"),
        chosenTaskType: "qa_prompt",
        utilityJson: {
          localeProfile: {
            dominantPrimaryTag: "english",
            codeSwitchRate: 0.02,
          },
          localeAdaptation: {
            applied: false,
            overrideApplied: false,
            reasonCodes: [],
          },
        },
        taskInstance: { taskId: "task_2" },
      },
    ],
    attemptScoreRows: [
      { taskId: "task_1", scoresJson: { taskScore: 74 } },
      { taskId: "task_2", scoresJson: { taskScore: 66 } },
    ],
  });

  assert.equal(report.totalDecisions, 2);
  assert.equal(report.localizedDecisionCount, 1);
  assert.equal(report.localizedDecisionShare, 0.5);
  assert.equal(report.localizedVsBaselineTaskScoreUplift, 8);
  assert.equal(report.reasonCodeCounts[0]?.key, "code_switch_high");
  assert.equal(report.localizedDecisionSamples[0]?.primaryTag, "sheng");
});
