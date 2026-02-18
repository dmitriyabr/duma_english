import { z } from "zod";
import { LOCALE_POLICY_CONTEXT_VERSION } from "@/lib/localization/localePolicyContext";

const nonNegativeInt = z.number().int().nonnegative();
const localePrimaryTagSchema = z.enum([
  "english",
  "swahili",
  "sheng",
  "home_language_hint",
  "unknown",
]);

const countRowSchema = z.object({
  key: z.string(),
  count: nonNegativeInt,
});

export const localePolicyDecisionSampleSchema = z.object({
  decisionId: z.string(),
  studentId: z.string(),
  decisionTs: z.string().datetime(),
  chosenTaskType: z.string(),
  primaryTag: localePrimaryTagSchema,
  codeSwitchRate: z.number().min(0).max(1),
  overrideApplied: z.boolean(),
  reasonCodes: z.array(z.string()),
});

export const localePolicyContextReportSchema = z.object({
  generatedAt: z.string().datetime(),
  version: z.literal(LOCALE_POLICY_CONTEXT_VERSION),
  windowDays: z.number().int().positive(),
  totalDecisions: nonNegativeInt,
  localizedDecisionCount: nonNegativeInt,
  localizedDecisionShare: z.number().min(0).max(1),
  localizedAvgTaskScore: z.number().min(0).max(100).nullable(),
  baselineAvgTaskScore: z.number().min(0).max(100).nullable(),
  localizedVsBaselineTaskScoreUplift: z.number().min(-100).max(100).nullable(),
  dominantPrimaryTagCounts: z.array(countRowSchema),
  reasonCodeCounts: z.array(countRowSchema),
  localizedDecisionSamples: z.array(localePolicyDecisionSampleSchema),
});

export type LocalePolicyContextReport = z.infer<typeof localePolicyContextReportSchema>;
