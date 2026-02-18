import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDiscoursePragmaticsBenchmark } from "./discoursePragmaticsBenchmarkReport";

test("summarizeDiscoursePragmaticsBenchmark reports agreement and coverage", () => {
  const report = summarizeDiscoursePragmaticsBenchmark({
    now: new Date("2026-02-18T00:00:00.000Z"),
    windowDays: 30,
    rows: [
      {
        transcript:
          "I think reading matters because it builds vocabulary. For example, I learn new words every week.",
        task: { type: "topic_talk", prompt: "Give a formal short talk." },
        taskEvaluationJson: {
          artifacts: {
            discoursePragmatics: {
              scores: {
                argumentStructure: 78,
                registerControl: 72,
                turnTakingRepair: 61,
                cohesion: 74,
                audienceFit: 70,
              },
            },
          },
        },
      },
      {
        transcript:
          "Hi, can you help me with homework? Sorry, let me rephrase, can we do it together today?",
        task: { type: "role_play", prompt: "Role-play a short conversation with your classmate." },
        taskEvaluationJson: {
          artifacts: {},
        },
      },
      {
        transcript: "I learn and share words.",
        task: { type: "target_vocab", prompt: "Use words." },
        taskEvaluationJson: {
          artifacts: {},
        },
      },
    ],
  });

  assert.equal(report.totalAttempts, 3);
  assert.equal(report.discourseAttempts, 2);
  assert.equal(report.engineCoverageCount, 1);
  assert.ok(report.engineCoverageRate !== null && report.engineCoverageRate > 0);

  const argument = report.dimensions.find((row) => row.dimension === "argumentStructure");
  assert.ok(argument);
  assert.equal(argument!.coverageCount, 2);
  assert.ok(argument!.agreementRate !== null);

  const topicTalk = report.byTaskType.find((row) => row.taskType === "topic_talk");
  assert.ok(topicTalk);
  assert.equal(topicTalk!.count, 1);
});
