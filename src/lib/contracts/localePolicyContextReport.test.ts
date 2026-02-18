import test from "node:test";
import assert from "node:assert/strict";
import { localePolicyContextReportSchema } from "./localePolicyContextReport";
import { LOCALE_POLICY_CONTEXT_VERSION } from "@/lib/localization/localePolicyContext";

test("locale policy context report schema accepts valid payload", () => {
  const parsed = localePolicyContextReportSchema.parse({
    generatedAt: "2026-02-18T06:55:00.000Z",
    version: LOCALE_POLICY_CONTEXT_VERSION,
    windowDays: 30,
    totalDecisions: 120,
    localizedDecisionCount: 34,
    localizedDecisionShare: 0.283333,
    localizedAvgTaskScore: 68.2,
    baselineAvgTaskScore: 64.5,
    localizedVsBaselineTaskScoreUplift: 3.7,
    dominantPrimaryTagCounts: [
      { key: "english", count: 20 },
      { key: "swahili", count: 10 },
      { key: "sheng", count: 4 },
    ],
    reasonCodeCounts: [
      { key: "code_switch_high", count: 19 },
      { key: "swahili_primary_pattern", count: 11 },
    ],
    localizedDecisionSamples: [
      {
        decisionId: "dec_1",
        studentId: "stu_1",
        decisionTs: "2026-02-18T06:20:00.000Z",
        chosenTaskType: "role_play",
        primaryTag: "sheng",
        codeSwitchRate: 0.42,
        overrideApplied: true,
        reasonCodes: ["code_switch_high", "sheng_primary_pattern"],
      },
    ],
  });

  assert.equal(parsed.version, LOCALE_POLICY_CONTEXT_VERSION);
  assert.equal(parsed.localizedDecisionCount, 34);
});
