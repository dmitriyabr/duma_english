import assert from "node:assert/strict";
import test from "node:test";
import {
  WRITING_PROGRESSION_DASHBOARD_VERSION,
  writingProgressionDashboardSchema,
} from "./writingProgressionDashboard";

test("writing progression dashboard contract accepts valid payload", () => {
  const parsed = writingProgressionDashboardSchema.parse({
    generatedAt: new Date("2026-02-19T00:00:00Z").toISOString(),
    contractVersion: WRITING_PROGRESSION_DASHBOARD_VERSION,
    windowDays: 30,
    totalWritingAttempts: 12,
    completedWritingAttempts: 10,
    averageTaskScore: 71.2,
    averageLanguageScore: 68.4,
    averageWordCount: 62.5,
    rewriteRecommendedRate: 0.4,
    revisionSubmissionRate: 0.35,
    byStage: [
      {
        stage: "A2",
        attempts: 5,
        averageTaskScore: 66.3,
        averageLanguageScore: 64.1,
      },
    ],
    byTaskType: [
      {
        taskType: "writing_prompt",
        attempts: 10,
        averageTaskScore: 71.2,
        averageWordCount: 62.5,
      },
    ],
  });

  assert.equal(parsed.contractVersion, WRITING_PROGRESSION_DASHBOARD_VERSION);
  assert.equal(parsed.byTaskType[0]?.taskType, "writing_prompt");
});
