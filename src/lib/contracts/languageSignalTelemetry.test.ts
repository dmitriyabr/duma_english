import test from "node:test";
import assert from "node:assert/strict";
import { languageSignalTelemetryReportSchema } from "./languageSignalTelemetry";
import { PERCEPTION_LANGUAGE_SIGNALS_VERSION } from "@/lib/perception/languageSignals";

test("language signal telemetry schema accepts valid payload", () => {
  const parsed = languageSignalTelemetryReportSchema.parse({
    generatedAt: "2026-02-18T06:40:00.000Z",
    version: PERCEPTION_LANGUAGE_SIGNALS_VERSION,
    windowDays: 30,
    totalAttempts: 12,
    taggedAttempts: 10,
    tagCoverageRate: 0.833333,
    codeSwitchDetectedCount: 3,
    codeSwitchDetectedRate: 0.3,
    lowConfidenceCount: 2,
    averagePrimaryConfidence: 0.78,
    primaryTagCounts: [
      { key: "english", count: 7 },
      { key: "swahili", count: 2 },
      { key: "sheng", count: 1 },
    ],
    tagPresenceCounts: [
      { key: "english", count: 10 },
      { key: "swahili", count: 4 },
      { key: "sheng", count: 3 },
      { key: "home_language_hint", count: 1 },
    ],
    homeLanguageHintCounts: [{ key: "luo", count: 1 }],
    calibrationSamples: [
      {
        attemptId: "att_1",
        studentId: "stu_1",
        createdAt: "2026-02-18T06:20:00.000Z",
        primaryTag: "english",
        primaryConfidence: 0.66,
        codeSwitchDetected: true,
        tagSet: ["english", "swahili"],
        transcriptPreview: "I am ready lakini leo niko sawa.",
      },
    ],
  });

  assert.equal(parsed.version, PERCEPTION_LANGUAGE_SIGNALS_VERSION);
  assert.equal(parsed.codeSwitchDetectedCount, 3);
});
