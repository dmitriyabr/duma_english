import assert from "node:assert/strict";
import test from "node:test";
import { summarizeWritingProgressionDashboard } from "./writingProgressionDashboard";

test("writing progression summary aggregates stage, scores, and revision rates", () => {
  const report = summarizeWritingProgressionDashboard({
    windowDays: 30,
    now: new Date("2026-02-19T00:00:00Z"),
    rows: [
      {
        id: "a1",
        taskId: "task_1",
        status: "completed",
        speechMetricsJson: { wordCount: 58 },
        scoresJson: { taskScore: 72, languageScore: 68 },
        taskEvaluationJson: {
          taskScore: 72,
          languageScore: 68,
          artifacts: {
            writingWordCount: 58,
            rewriteRecommended: true,
          },
        },
        task: {
          type: "writing_prompt",
          metaJson: { stage: "A2" },
        },
      },
      {
        id: "a2",
        taskId: "task_1",
        status: "completed",
        speechMetricsJson: { wordCount: 73 },
        scoresJson: { taskScore: 83, languageScore: 79 },
        taskEvaluationJson: {
          taskScore: 83,
          languageScore: 79,
          artifacts: {
            writingWordCount: 73,
            rewriteRecommended: false,
          },
        },
        task: {
          type: "writing_prompt",
          metaJson: { stage: "A2" },
        },
      },
      {
        id: "a3",
        taskId: "task_2",
        status: "needs_retry",
        speechMetricsJson: { wordCount: 12 },
        scoresJson: null,
        taskEvaluationJson: null,
        task: {
          type: "writing_prompt",
          metaJson: { stage: "A2" },
        },
      },
    ],
  });

  assert.equal(report.totalWritingAttempts, 3);
  assert.equal(report.completedWritingAttempts, 2);
  assert.equal(report.revisionSubmissionRate, 0.5);
  assert.equal(report.rewriteRecommendedRate, 0.5);
  assert.equal(report.byStage[0]?.stage, "A2");
  assert.equal(report.byTaskType[0]?.taskType, "writing_prompt");
  assert.equal(report.byTaskType[0]?.averageWordCount, 65.5);
});
