import assert from "node:assert/strict";
import test from "node:test";
import {
  getL1InterferencePrior,
  L1_INTERFERENCE_PRIOR_VERSION,
  toInterferenceDomain,
} from "./interferencePrior";

test("interference prior returns stable template for age/domain", () => {
  const prior = getL1InterferencePrior({
    ageBand: "9-11",
    domain: "grammar",
  });

  assert.equal(prior.version, L1_INTERFERENCE_PRIOR_VERSION);
  assert.equal(prior.domain, "grammar");
  assert.equal(prior.template.key, "l1_grammar_minimal_pairs_9_11");
  assert.ok(prior.priorBoost > 0.2);
});

test("language signals increase interference prior boost", () => {
  const baseline = getL1InterferencePrior({
    ageBand: "12-14",
    domain: "lo",
    languageSignals: {
      primaryTag: "english",
      tagSet: ["english"],
      codeSwitchDetected: false,
      homeLanguageHints: [],
    },
  });
  const enriched = getL1InterferencePrior({
    ageBand: "12-14",
    domain: "lo",
    languageSignals: {
      primaryTag: "swahili",
      tagSet: ["english", "swahili", "sheng"],
      codeSwitchDetected: true,
      homeLanguageHints: ["kikuyu"],
    },
  });

  assert.ok(enriched.priorBoost > baseline.priorBoost);
  assert.ok(enriched.languageSignalScore > baseline.languageSignalScore);
  assert.ok(enriched.reasonCodes.includes("code_switch_detected"));
  assert.ok(enriched.reasonCodes.includes("non_english_primary_tag"));
});

test("unknown age band falls back to 9-11 bucket", () => {
  const prior = getL1InterferencePrior({
    ageBand: "15-17",
    domain: "vocab",
  });

  assert.equal(prior.template.key, "l1_vocab_false_friends_9_11");
  assert.ok(prior.reasonCodes.includes("age_band_fallback_9_11"));
});

test("interference domain helper normalizes unknown values", () => {
  assert.equal(toInterferenceDomain("grammar"), "grammar");
  assert.equal(toInterferenceDomain("unknown"), "mixed");
  assert.equal(toInterferenceDomain(null), "mixed");
});
