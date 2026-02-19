import test from "node:test";
import assert from "node:assert/strict";
import {
  READING_RUNTIME_REPORT_VERSION,
  readingRuntimeReportSchema,
} from "./readingRuntimeReport";

test("reading runtime report schema accepts valid payload", () => {
  const parsed = readingRuntimeReportSchema.parse({
    generatedAt: "2026-02-19T14:30:00.000Z",
    contractVersion: READING_RUNTIME_REPORT_VERSION,
    windowDays: 30,
    totalAttempts: 120,
    readingAttempts: 14,
    readingAttemptShare: 0.116667,
    avgTaskScore: 68.2,
    avgReadingComprehensionScore: 69.1,
    avgSourceGroundingScore: 65.3,
    avgQuestionAddressingScore: 71,
    passRate: 0.642857,
    byStage: [
      { stage: "A2", attemptCount: 6, avgTaskScore: 66.5, passRate: 0.5 },
      { stage: "B1", attemptCount: 8, avgTaskScore: 69.4, passRate: 0.75 },
    ],
    samples: [
      {
        attemptId: "att_1",
        studentId: "stu_1",
        taskId: "task_1",
        createdAt: "2026-02-19T12:00:00.000Z",
        stage: "A2",
        taskScore: 67,
        readingComprehensionScore: 69,
        sourceGroundingScore: 63,
        questionAddressingScore: 71,
      },
    ],
  });

  assert.equal(parsed.contractVersion, READING_RUNTIME_REPORT_VERSION);
  assert.equal(parsed.readingAttempts, 14);
});
