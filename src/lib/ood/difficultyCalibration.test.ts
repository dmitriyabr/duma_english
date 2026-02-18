import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_DIFFICULTY_PROFILES,
  buildDifficultyAnchorMetadata,
  buildDifficultyAnchorStabilityReport,
  buildDifficultyCalibrationSet,
  calibrateDifficultyToSharedScale,
} from "./difficultyCalibration";

test("calibrateDifficultyToSharedScale maps per-family raw difficulty to shared scale", () => {
  const calibrated = calibrateDifficultyToSharedScale({
    taskType: "role_play",
    estimatedDifficulty: 70,
  });
  assert.equal(calibrated.taskType, "role_play");
  assert.equal(calibrated.rawDifficulty, 70);
  assert.ok(calibrated.sharedScaleDifficulty > 50);
});

test("buildDifficultyCalibrationSet derives sample-backed profiles", () => {
  const set = buildDifficultyCalibrationSet({
    rows: [
      { taskType: "target_vocab", estimatedDifficulty: 40, createdAt: new Date("2026-02-01T00:00:00Z") },
      { taskType: "target_vocab", estimatedDifficulty: 50, createdAt: new Date("2026-02-02T00:00:00Z") },
      { taskType: "qa_prompt", estimatedDifficulty: 60, createdAt: new Date("2026-02-03T00:00:00Z") },
    ],
    now: new Date("2026-02-17T00:00:00Z"),
  });

  assert.equal(set.profiles.target_vocab.mean, 45);
  assert.equal(set.profiles.target_vocab.sampleSize, 2);
  assert.equal(set.profiles.qa_prompt.sampleSize, 1);
  assert.equal(set.profiles.read_aloud.mean, BASELINE_DIFFICULTY_PROFILES.read_aloud.mean);
});

test("buildDifficultyAnchorStabilityReport emits health buckets and shared stats", () => {
  const { report } = buildDifficultyAnchorStabilityReport({
    rows: [
      { taskType: "role_play", estimatedDifficulty: 80, createdAt: new Date("2026-02-10T00:00:00Z") },
      { taskType: "role_play", estimatedDifficulty: 84, createdAt: new Date("2026-02-11T00:00:00Z") },
      { taskType: "topic_talk", estimatedDifficulty: 57, createdAt: new Date("2026-02-11T00:00:00Z") },
    ],
    windowDays: 30,
    now: new Date("2026-02-17T00:00:00Z"),
  });

  const rolePlay = report.profiles.find((row) => row.taskType === "role_play");
  assert.ok(rolePlay);
  assert.ok(rolePlay!.deltaFromBaselineMean > 8);
  assert.equal(rolePlay!.calibrationHealth, "unstable");
  assert.equal(report.totalSamples, 3);
  assert.ok(typeof report.sharedScaleStats.mean === "number");
});

test("buildDifficultyAnchorMetadata includes calibration fields for persistence", () => {
  const metadata = buildDifficultyAnchorMetadata({
    taskType: "qa_prompt",
    estimatedDifficulty: 52,
  });
  assert.equal(metadata.calibrationVersion, "difficulty-calibration-v1");
  assert.equal(metadata.taskType, "qa_prompt");
  assert.ok(typeof metadata.sharedScaleDifficulty === "number");
});
