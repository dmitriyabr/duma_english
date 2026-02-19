import test from "node:test";
import assert from "node:assert/strict";
import { advancedDiscourseTaskFamiliesReportSchema } from "./advancedDiscourseTaskFamiliesReport";

test("advanced discourse task families report schema accepts valid payload", () => {
  const parsed = advancedDiscourseTaskFamiliesReportSchema.parse({
    generatedAt: "2026-02-19T00:00:00.000Z",
    contractVersion: "advanced-discourse-task-families-report-v1",
    windowDays: 30,
    baselineTaskFamilies: [
      "read_aloud",
      "target_vocab",
      "qa_prompt",
      "role_play",
      "topic_talk",
      "filler_control",
      "speech_builder",
    ],
    currentTaskFamilies: [
      "read_aloud",
      "target_vocab",
      "qa_prompt",
      "role_play",
      "topic_talk",
      "filler_control",
      "speech_builder",
      "argumentation",
      "register_switch",
      "misunderstanding_repair",
    ],
    addedTaskFamilies: ["argumentation", "register_switch", "misunderstanding_repair"],
    removedTaskFamilies: [],
    catalogRows: [
      {
        taskType: "argumentation",
        classification: "advanced_discourse",
        fromTemplateCatalog: true,
        supportsDiscoursePragmatics: true,
        stageCoverage: ["C1", "C2"],
      },
    ],
    passRateByTaskFamily: [
      {
        taskType: "argumentation",
        attempts: 8,
        passedAttempts: 5,
        passRate: 0.625,
      },
    ],
    totals: {
      attemptsConsidered: 8,
      scoredAttempts: 8,
    },
  });

  assert.equal(parsed.contractVersion, "advanced-discourse-task-families-report-v1");
  assert.equal(parsed.addedTaskFamilies.length, 3);
});
