import assert from "node:assert/strict";
import test from "node:test";

import { summarizeCrossModalityPlacement } from "./crossModality";

test("cross-modality summary reports missing domains when coverage is partial", () => {
  const summary = summarizeCrossModalityPlacement({
    rows: [
      {
        taskType: "read_aloud",
        taskMetaJson: { assessmentMode: "pa" },
        taskEvaluationJson: { grammarChecks: [{ pass: true }], vocabChecks: [{ pass: true }] },
        scoresJson: { taskScore: 72 },
      },
      {
        taskType: "reading_comprehension",
        taskMetaJson: {},
        taskEvaluationJson: { grammarChecks: [{ pass: true }] },
        scoresJson: { taskScore: 68 },
      },
    ],
  });

  assert.equal(summary.stopCriteriaSatisfied, false);
  assert.equal(summary.missingDomains.includes("writing"), true);
  assert.equal(summary.missingDomains.includes("listening"), true);
  assert.equal(summary.coverageRate < 1, true);
});

test("cross-modality summary satisfies stop criteria with full domain evidence and low uncertainty", () => {
  const rows = [
    { taskType: "read_aloud", taskMetaJson: {}, taskEvaluationJson: { grammarChecks: [{ pass: true }], vocabChecks: [{ pass: true }] }, scoresJson: { taskScore: 78 } },
    { taskType: "topic_talk", taskMetaJson: {}, taskEvaluationJson: { grammarChecks: [{ pass: true }], vocabChecks: [{ pass: true }] }, scoresJson: { taskScore: 76 } },
    { taskType: "reading_comprehension", taskMetaJson: {}, taskEvaluationJson: { grammarChecks: [{ pass: true }] }, scoresJson: { taskScore: 74 } },
    { taskType: "listening_comprehension", taskMetaJson: {}, taskEvaluationJson: { vocabChecks: [{ pass: true }] }, scoresJson: { taskScore: 73 } },
    { taskType: "writing_prompt", taskMetaJson: { assessmentMode: "text" }, taskEvaluationJson: { grammarChecks: [{ pass: true }], vocabChecks: [{ pass: true }] }, scoresJson: { taskScore: 75 } },
    { taskType: "writing_prompt", taskMetaJson: { assessmentMode: "text" }, taskEvaluationJson: { grammarChecks: [{ pass: true }], vocabChecks: [{ pass: true }] }, scoresJson: { taskScore: 77 } },
    { taskType: "listening_comprehension", taskMetaJson: {}, taskEvaluationJson: { vocabChecks: [{ pass: true }] }, scoresJson: { taskScore: 79 } },
    { taskType: "reading_comprehension", taskMetaJson: {}, taskEvaluationJson: { grammarChecks: [{ pass: true }] }, scoresJson: { taskScore: 80 } },
  ];

  const summary = summarizeCrossModalityPlacement({ rows });

  assert.equal(summary.missingDomains.length, 0);
  assert.equal(summary.stopCriteriaSatisfied, true);
  assert.equal(summary.coverageRate, 1);
  assert.equal(summary.maxUncertainty <= 0.35, true);
});
