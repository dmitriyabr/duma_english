import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOfflineReplayDatasetFromRows,
  type OfflineReplayDelayedOutcomeRow,
  type OfflineReplayEventRow,
} from "./offlineDataset";

function eventRow(input: {
  id: string;
  eventType: string;
  createdAt: string;
  studentId?: string;
  decisionLogId?: string;
  taskInstanceId?: string;
  taskId?: string;
  attemptId?: string;
  delayedOutcomeId?: string;
  payloadJson?: unknown;
}): OfflineReplayEventRow {
  return {
    id: input.id,
    eventType: input.eventType,
    createdAt: new Date(input.createdAt),
    studentId: input.studentId || null,
    decisionLogId: input.decisionLogId || null,
    taskInstanceId: input.taskInstanceId || null,
    taskId: input.taskId || null,
    attemptId: input.attemptId || null,
    delayedOutcomeId: input.delayedOutcomeId || null,
    payloadJson: input.payloadJson ?? null,
  };
}

function delayedRow(input: {
  id: string;
  status: string;
  outcomeWindow: string;
  createdAt: string;
  outcomeJson: unknown;
}): OfflineReplayDelayedOutcomeRow {
  return {
    id: input.id,
    status: input.status,
    outcomeWindow: input.outcomeWindow,
    createdAt: new Date(input.createdAt),
    outcomeJson: input.outcomeJson,
  };
}

test("buildOfflineReplayDatasetFromRows builds complete replay row", () => {
  const events: OfflineReplayEventRow[] = [
    eventRow({
      id: "evt_1",
      eventType: "planner_decision_created",
      createdAt: "2026-02-18T00:00:00.000Z",
      studentId: "stu_1",
      decisionLogId: "dec_1",
      payloadJson: {
        chosenTaskType: "role_play",
        targetNodeIds: ["node_1", "node_2"],
        selectionReason: "maximize_gain",
        primaryGoal: "transfer_probe",
        ambiguityTriggerApplied: false,
        causalRemediationApplied: true,
        causalRemediationTopCause: "rule_confusion",
      },
    }),
    eventRow({
      id: "evt_2",
      eventType: "task_instance_created",
      createdAt: "2026-02-18T00:00:02.000Z",
      studentId: "stu_1",
      decisionLogId: "dec_1",
      taskInstanceId: "ti_1",
      taskId: "task_1",
      payloadJson: {
        taskType: "role_play",
        targetNodeIds: ["node_1", "node_2"],
        fallbackUsed: false,
        estimatedDifficulty: 51,
      },
    }),
    eventRow({
      id: "evt_3",
      eventType: "attempt_created",
      createdAt: "2026-02-18T00:00:20.000Z",
      studentId: "stu_1",
      decisionLogId: "dec_1",
      taskInstanceId: "ti_1",
      taskId: "task_1",
      attemptId: "att_1",
      payloadJson: {
        status: "created",
        durationSec: 18,
        contentType: "audio/webm",
      },
    }),
    eventRow({
      id: "evt_4",
      eventType: "delayed_outcome_recorded",
      createdAt: "2026-02-18T00:02:00.000Z",
      studentId: "stu_1",
      decisionLogId: "dec_1",
      taskInstanceId: "ti_1",
      taskId: "task_1",
      attemptId: "att_1",
      delayedOutcomeId: "out_1",
      payloadJson: {
        outcomeWindow: "same_session",
        evidenceCount: 3,
        nodeOutcomeCount: 2,
        masteryDeltaTotal: 0.17,
      },
    }),
  ];

  const delayedOutcomes: OfflineReplayDelayedOutcomeRow[] = [
    delayedRow({
      id: "out_1",
      status: "recorded",
      outcomeWindow: "same_session",
      createdAt: "2026-02-18T00:01:58.000Z",
      outcomeJson: {
        evidenceCount: 4,
        nodeOutcomeCount: 3,
        masteryDeltaTotal: 0.2,
      },
    }),
  ];

  const dataset = buildOfflineReplayDatasetFromRows({
    eventRows: events,
    delayedOutcomeRows: delayedOutcomes,
    windowDays: 30,
    now: new Date("2026-02-18T01:00:00.000Z"),
  });

  assert.equal(dataset.totalEvents, 4);
  assert.equal(dataset.totalDecisionGroups, 1);
  assert.equal(dataset.completeness.completeRows, 1);
  assert.equal(dataset.completeness.incompleteRows, 0);
  assert.equal(dataset.completeness.completenessRate, 1);

  const row = dataset.rows[0];
  assert.equal(row.decisionLogId, "dec_1");
  assert.equal(row.studentId, "stu_1");
  assert.equal(row.context.chosenTaskType, "role_play");
  assert.deepEqual(row.context.targetNodeIds, ["node_1", "node_2"]);
  assert.equal(row.action.taskType, "role_play");
  assert.equal(row.action.durationSec, 18);
  assert.equal(row.delayedOutcome.outcomeWindow, "same_session");
  assert.equal(row.delayedOutcome.evidenceCount, 3);
  assert.equal(row.delayedOutcome.nodeOutcomeCount, 2);
  assert.equal(row.completeness.isComplete, true);
  assert.deepEqual(row.completeness.missing, []);
});

test("buildOfflineReplayDatasetFromRows marks rows incomplete when linkage is missing", () => {
  const events: OfflineReplayEventRow[] = [
    eventRow({
      id: "evt_10",
      eventType: "planner_decision_created",
      createdAt: "2026-02-18T02:00:00.000Z",
      studentId: "stu_2",
      decisionLogId: "dec_2",
      payloadJson: {
        chosenTaskType: "qa_prompt",
      },
    }),
    eventRow({
      id: "evt_11",
      eventType: "task_instance_created",
      createdAt: "2026-02-18T02:00:01.000Z",
      studentId: "stu_2",
      decisionLogId: "dec_2",
      taskInstanceId: "ti_2",
      taskId: "task_2",
      payloadJson: {
        taskType: "qa_prompt",
      },
    }),
    eventRow({
      id: "evt_12",
      eventType: "delayed_outcome_recorded",
      createdAt: "2026-02-18T02:01:00.000Z",
      studentId: "stu_2",
      decisionLogId: "dec_2",
      taskInstanceId: "ti_2",
      taskId: "task_2",
      payloadJson: {},
    }),
  ];

  const dataset = buildOfflineReplayDatasetFromRows({
    eventRows: events,
    windowDays: 30,
    now: new Date("2026-02-18T03:00:00.000Z"),
  });

  assert.equal(dataset.totalDecisionGroups, 1);
  assert.equal(dataset.completeness.completeRows, 0);
  assert.equal(dataset.completeness.incompleteRows, 1);
  assert.equal(dataset.completeness.missingAttemptEvent, 1);
  assert.equal(dataset.completeness.missingOutcomePayload, 1);
  assert.equal(dataset.completeness.missingLinkage, 1);

  const row = dataset.rows[0];
  assert.equal(row.completeness.isComplete, false);
  assert.deepEqual(row.completeness.missing, ["attempt_event", "delayed_outcome_payload", "linkage_ids"]);
});
