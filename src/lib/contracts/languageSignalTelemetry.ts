import { z } from "zod";
import { PERCEPTION_LANGUAGE_SIGNALS_VERSION } from "@/lib/perception/languageSignals";

const nonNegativeInt = z.number().int().nonnegative();
const languageTagSchema = z.enum(["english", "swahili", "sheng", "home_language_hint", "unknown"]);

export const languageSignalCountRowSchema = z.object({
  key: z.string(),
  count: nonNegativeInt,
});

export const languageSignalCalibrationSampleSchema = z.object({
  attemptId: z.string(),
  studentId: z.string(),
  createdAt: z.string().datetime(),
  primaryTag: languageTagSchema,
  primaryConfidence: z.number().min(0).max(1),
  codeSwitchDetected: z.boolean(),
  tagSet: z.array(languageTagSchema),
  transcriptPreview: z.string(),
});

export const languageSignalTelemetryReportSchema = z.object({
  generatedAt: z.string().datetime(),
  version: z.literal(PERCEPTION_LANGUAGE_SIGNALS_VERSION),
  windowDays: z.number().int().positive(),
  totalAttempts: nonNegativeInt,
  taggedAttempts: nonNegativeInt,
  tagCoverageRate: z.number().min(0).max(1),
  codeSwitchDetectedCount: nonNegativeInt,
  codeSwitchDetectedRate: z.number().min(0).max(1),
  lowConfidenceCount: nonNegativeInt,
  averagePrimaryConfidence: z.number().min(0).max(1).nullable(),
  primaryTagCounts: z.array(languageSignalCountRowSchema),
  tagPresenceCounts: z.array(languageSignalCountRowSchema),
  homeLanguageHintCounts: z.array(languageSignalCountRowSchema),
  calibrationSamples: z.array(languageSignalCalibrationSampleSchema),
});

export type LanguageSignalTelemetryReport = z.infer<typeof languageSignalTelemetryReportSchema>;
