import test from "node:test";
import assert from "node:assert/strict";
import { inferPerceptionLanguageSignals } from "./languageSignals";

test("language signals classify english-only transcript as english without code switch", () => {
  const signals = inferPerceptionLanguageSignals({
    transcript: "I learn at school with my friend because practice helps me speak better.",
  });

  assert.equal(signals.primaryTag, "english");
  assert.equal(signals.codeSwitch.detected, false);
  assert.ok(signals.primaryConfidence >= 0.7);
});

test("language signals detect mixed english, swahili, and sheng transcript", () => {
  const signals = inferPerceptionLanguageSignals({
    transcript: "I am ready lakini leo niko sawa manze and my msee is here.",
  });

  const tags = new Set(signals.tags.map((row) => row.tag));
  assert.equal(signals.codeSwitch.detected, true);
  assert.equal(tags.has("english"), true);
  assert.equal(tags.has("swahili"), true);
  assert.equal(tags.has("sheng"), true);
});

test("language signals surface home-language hints when known lexicon tokens appear", () => {
  const signals = inferPerceptionLanguageSignals({
    transcript: "Mulembe rafiki ber ahinya today we learn together.",
  });

  const hints = new Set(signals.homeLanguageHints.map((row) => row.language));
  assert.equal(hints.has("luhya"), true);
  assert.equal(hints.has("luo"), true);
  assert.ok(signals.homeLanguageHints.length >= 2);
});
