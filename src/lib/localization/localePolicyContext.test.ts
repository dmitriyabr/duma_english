import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalePolicyContext,
  extractLocaleSignalSample,
  summarizeLocalePolicyProfile,
} from "./localePolicyContext";

test("extractLocaleSignalSample returns null when language signals are missing", () => {
  const parsed = extractLocaleSignalSample({
    artifacts: {},
  });

  assert.equal(parsed, null);
});

test("summarizeLocalePolicyProfile marks localized cohort for code-switch heavy samples", () => {
  const profile = summarizeLocalePolicyProfile([
    { primaryTag: "english", primaryConfidence: 0.8, codeSwitchDetected: true, homeLanguageHints: [] },
    { primaryTag: "swahili", primaryConfidence: 0.7, codeSwitchDetected: true, homeLanguageHints: [] },
    { primaryTag: "english", primaryConfidence: 0.88, codeSwitchDetected: false, homeLanguageHints: [] },
  ]);

  assert.equal(profile.localizedCohort, true);
  assert.ok(profile.codeSwitchRate >= 0.3);
  assert.equal(profile.primaryTagShares.swahili > 0, true);
});

test("buildLocalePolicyContext recommends role_play override for sheng/code-switch pattern", () => {
  const context = buildLocalePolicyContext({
    plannerChosenTaskType: "target_vocab",
    samples: [
      { primaryTag: "sheng", primaryConfidence: 0.73, codeSwitchDetected: true, homeLanguageHints: [] },
      { primaryTag: "english", primaryConfidence: 0.68, codeSwitchDetected: true, homeLanguageHints: [] },
      { primaryTag: "sheng", primaryConfidence: 0.7, codeSwitchDetected: true, homeLanguageHints: [] },
    ],
  });

  assert.equal(context.adaptation.applied, true);
  assert.equal(context.adaptation.overrideTaskType, "role_play");
  assert.equal(context.adaptation.reasonCodes.includes("code_switch_high"), true);
});
