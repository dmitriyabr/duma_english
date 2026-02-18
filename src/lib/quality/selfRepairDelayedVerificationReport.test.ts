import assert from "node:assert/strict";
import test from "node:test";
import { __internal } from "./selfRepairDelayedVerificationReport";

test("delayed verification report tracks duplicate and missing counters", () => {
  const report = __internal.summarizeRows({
    now: new Date("2026-02-18T00:00:00Z"),
    windowDays: 30,
    staleThresholdHours: 48,
    rows: [
      {
        createdAt: new Date("2026-02-15T00:00:00Z"),
        status: "pending_delayed_verification",
        delayedVerificationTaskInstanceId: null,
        delayedVerificationAttemptId: null,
        metadataJson: {
          sourceTaskType: "qa_prompt",
          sourcePrompt: "Describe your teacher.",
        },
        sourceAttempt: { task: { type: "qa_prompt", prompt: "Describe your teacher." } },
        delayedVerificationAttempt: null,
      },
      {
        createdAt: new Date("2026-02-17T00:00:00Z"),
        status: "completed",
        delayedVerificationTaskInstanceId: "ti_1",
        delayedVerificationAttemptId: "att_1",
        metadataJson: {
          sourceTaskType: "qa_prompt",
          sourcePrompt: "Describe your school day.",
          delayedVerificationTaskType: "qa_prompt",
          delayedVerificationPrompt: "Describe your school day.",
        },
        sourceAttempt: { task: { type: "qa_prompt", prompt: "Describe your school day." } },
        delayedVerificationAttempt: {
          task: { type: "qa_prompt", prompt: "Describe your school day." },
        },
      },
      {
        createdAt: new Date("2026-02-17T00:00:00Z"),
        status: "completed",
        delayedVerificationTaskInstanceId: "ti_2",
        delayedVerificationAttemptId: "att_2",
        metadataJson: {
          sourceTaskType: "qa_prompt",
          sourcePrompt: "Explain your hobby.",
          delayedVerificationTaskType: "role_play",
          delayedVerificationPrompt: "Role-play inviting a friend to an activity.",
        },
        sourceAttempt: { task: { type: "qa_prompt", prompt: "Explain your hobby." } },
        delayedVerificationAttempt: {
          task: {
            type: "role_play",
            prompt: "Role-play inviting a friend to an activity.",
          },
        },
      },
    ],
  });

  assert.equal(report.totalCycles, 3);
  assert.equal(report.pendingDelayedCount, 1);
  assert.equal(report.delayedAttemptLinkedCount, 2);
  assert.equal(report.validVerificationCount, 1);
  assert.equal(report.invalidVerificationCount, 2);
  assert.equal(report.invalidDuplicateTaskFamilyCount, 1);
  assert.equal(report.invalidDuplicatePromptCount, 1);
  assert.equal(report.missingDelayedVerificationCount, 1);
});
