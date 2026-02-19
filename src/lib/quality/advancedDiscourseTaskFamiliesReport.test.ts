import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAdvancedDiscourseTaskFamiliesReport } from "./advancedDiscourseTaskFamiliesReport";

test("summarizeAdvancedDiscourseTaskFamiliesReport builds catalog diff and pass rates", () => {
  const report = summarizeAdvancedDiscourseTaskFamiliesReport({
    now: new Date("2026-02-19T00:00:00.000Z"),
    windowDays: 30,
    rows: [
      {
        scoresJson: { taskScore: 78 },
        taskEvaluationJson: {},
        task: { type: "argumentation" },
      },
      {
        scoresJson: { taskScore: 54 },
        taskEvaluationJson: {},
        task: { type: "argumentation" },
      },
      {
        scoresJson: { taskScore: 82 },
        taskEvaluationJson: {},
        task: { type: "register_switch" },
      },
      {
        scoresJson: { taskScore: 66 },
        taskEvaluationJson: {},
        task: { type: "qa_prompt" },
      },
    ],
  });

  assert.equal(
    report.addedTaskFamilies.includes("misunderstanding_repair"),
    true,
  );
  assert.equal(report.removedTaskFamilies.length, 0);

  const argumentation = report.passRateByTaskFamily.find(
    (row) => row.taskType === "argumentation",
  );
  assert.ok(argumentation);
  assert.equal(argumentation!.attempts, 2);
  assert.equal(argumentation!.passedAttempts, 1);
  assert.equal(argumentation!.passRate, 0.5);

  const registerSwitch = report.passRateByTaskFamily.find(
    (row) => row.taskType === "register_switch",
  );
  assert.ok(registerSwitch);
  assert.equal(registerSwitch!.attempts, 1);
  assert.equal(registerSwitch!.passedAttempts, 1);
  assert.equal(registerSwitch!.passRate, 1);
});
