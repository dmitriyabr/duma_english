import assert from "node:assert/strict";
import test from "node:test";
import { replayDatasetCompletenessReportSchema } from "./replayDatasetCompleteness";

test("replay dataset completeness report schema accepts valid payload", () => {
  const parsed = replayDatasetCompletenessReportSchema.safeParse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    datasetVersion: "offline-replay-dataset-v1",
    windowDays: 30,
    eventLimit: 50000,
    decisionLimit: 5000,
    summary: {
      totalEvents: 128,
      totalDecisionGroups: 25,
      completeRows: 19,
      incompleteRows: 6,
      completenessRate: 0.76,
      eventTypeCounts: {
        planner_decision_created: 25,
        task_instance_created: 24,
        attempt_created: 23,
        delayed_outcome_recorded: 20,
      },
      missing: {
        missingDecisionEvent: 0,
        missingTaskInstanceEvent: 1,
        missingAttemptEvent: 2,
        missingDelayedOutcomeEvent: 5,
        missingOutcomePayload: 4,
        missingLinkage: 1,
      },
    },
    incompleteSamples: [
      {
        decisionLogId: "dec_1",
        studentId: "stu_1",
        missing: ["attempt_event"],
        timestamps: {
          decisionTs: "2026-02-18T00:01:00.000Z",
          delayedOutcomeTs: null,
        },
      },
    ],
  });

  assert.equal(parsed.success, true);
});
