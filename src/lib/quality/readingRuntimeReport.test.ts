import test from "node:test";
import assert from "node:assert/strict";
import { summarizeReadingRuntimeReport } from "./readingRuntimeReport";

test("reading runtime report summarizes reading attempts and stage stats", () => {
  const report = summarizeReadingRuntimeReport({
    windowDays: 30,
    now: new Date("2026-02-19T14:40:00.000Z"),
    rows: [
      {
        id: "att_1",
        studentId: "stu_1",
        taskId: "task_1",
        createdAt: new Date("2026-02-19T10:00:00.000Z"),
        taskEvaluationJson: {
          taskScore: 72,
          artifacts: {
            readingComprehensionScore: 74,
            readingSourceGroundingScore: 70,
            readingQuestionAddressingScore: 78,
          },
        },
        scoresJson: { taskScore: 72 },
        task: {
          type: "reading_comprehension",
          metaJson: { stage: "A2" },
        },
      },
      {
        id: "att_2",
        studentId: "stu_2",
        taskId: "task_2",
        createdAt: new Date("2026-02-19T09:00:00.000Z"),
        taskEvaluationJson: {
          taskScore: 58,
          artifacts: {
            readingComprehensionScore: 57,
            readingSourceGroundingScore: 52,
            readingQuestionAddressingScore: 61,
          },
        },
        scoresJson: { taskScore: 58 },
        task: {
          type: "reading_comprehension",
          metaJson: { stage: "A2" },
        },
      },
      {
        id: "att_3",
        studentId: "stu_3",
        taskId: "task_3",
        createdAt: new Date("2026-02-19T08:00:00.000Z"),
        taskEvaluationJson: {},
        scoresJson: { taskScore: 66 },
        task: {
          type: "qa_prompt",
          metaJson: { stage: "A2" },
        },
      },
    ],
  });

  assert.equal(report.totalAttempts, 3);
  assert.equal(report.readingAttempts, 2);
  assert.equal(report.readingAttemptShare, 0.666667);
  assert.equal(report.avgTaskScore, 65);
  assert.equal(report.passRate, 0.5);
  assert.equal(report.byStage[0]?.stage, "A2");
  assert.equal(report.byStage[0]?.attemptCount, 2);
  assert.equal(report.samples.length, 2);
});
