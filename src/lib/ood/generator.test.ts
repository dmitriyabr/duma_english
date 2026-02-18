import assert from "node:assert/strict";
import test from "node:test";
import { buildOodTaskSpecCandidate, shouldInjectOodTask } from "./generator";

test("shouldInjectOodTask fires on configured cadence", () => {
  assert.equal(shouldInjectOodTask(5), false);
  assert.equal(shouldInjectOodTask(6), true);
  assert.equal(shouldInjectOodTask(12), true);
});

test("OOD candidate is null when task is not on OOD cadence", () => {
  const candidate = buildOodTaskSpecCandidate({
    studentId: "stu_1",
    taskType: "qa_prompt",
    taskOrdinal: 5,
    decisionLogId: "dec_1",
    estimatedDifficulty: 47,
  });
  assert.equal(candidate, null);
});

test("OOD candidate uses axis tags and metadata on cadence", () => {
  const candidate = buildOodTaskSpecCandidate({
    studentId: "stu_1",
    taskType: "role_play",
    taskOrdinal: 6,
    decisionLogId: "dec_2",
    estimatedDifficulty: 52,
  });
  assert.ok(candidate);
  assert.equal(candidate?.status, "planned");
  assert.equal(candidate?.axisTags.length, 2);
  assert.ok(typeof candidate?.difficultyAnchor === "number");
  assert.equal((candidate?.metadata as Record<string, unknown>).generatorVersion, "ood-generator-v1");
  const calibration = (candidate?.metadata as { difficultyCalibration?: { sharedScaleDifficulty?: number } })
    .difficultyCalibration;
  assert.ok(typeof calibration?.sharedScaleDifficulty === "number");
});
