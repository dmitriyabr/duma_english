import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLanguageSignalTelemetry } from "./languageSignalTelemetry";

test("language signal telemetry summarizes tag coverage, code-switch rate, and calibration samples", () => {
  const report = summarizeLanguageSignalTelemetry({
    windowDays: 30,
    now: new Date("2026-02-18T06:45:00.000Z"),
    sampleLimit: 5,
    attemptRows: [
      {
        id: "att_1",
        studentId: "stu_1",
        createdAt: new Date("2026-02-18T06:30:00.000Z"),
        transcript: "I am ready lakini leo niko sawa manze.",
        taskEvaluationJson: {
          artifacts: {
            languageSignals: {
              primaryTag: "english",
              primaryConfidence: 0.62,
              tags: [{ tag: "english" }, { tag: "swahili" }, { tag: "sheng" }],
              codeSwitch: { detected: true },
              homeLanguageHints: [{ language: "luo" }],
            },
          },
        },
      },
      {
        id: "att_2",
        studentId: "stu_2",
        createdAt: new Date("2026-02-18T06:00:00.000Z"),
        transcript: "I learn at school with my friend.",
        taskEvaluationJson: {
          artifacts: {
            languageSignals: {
              primaryTag: "english",
              primaryConfidence: 0.92,
              tags: [{ tag: "english" }],
              codeSwitch: { detected: false },
              homeLanguageHints: [],
            },
          },
        },
      },
      {
        id: "att_3",
        studentId: "stu_3",
        createdAt: new Date("2026-02-18T05:00:00.000Z"),
        transcript: "No language signals here",
        taskEvaluationJson: {
          artifacts: {},
        },
      },
    ],
  });

  assert.equal(report.totalAttempts, 3);
  assert.equal(report.taggedAttempts, 2);
  assert.equal(report.codeSwitchDetectedCount, 1);
  assert.equal(report.lowConfidenceCount, 1);
  assert.equal(report.calibrationSamples.length, 1);
  assert.equal(report.homeLanguageHintCounts[0]?.key, "luo");
});
