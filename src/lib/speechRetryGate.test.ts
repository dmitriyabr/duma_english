import assert from "node:assert/strict";
import test from "node:test";
import { SPEECH_RETRY_MESSAGE, evaluateSpeechRetryGate } from "./speechRetryGate";

test("retry gate marks empty transcript as no speech", () => {
  const decision = evaluateSpeechRetryGate({
    transcript: "",
    metrics: { durationSec: 2.1, wordCount: 0, confidence: 0.2 },
  });
  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.reasonCode, "RETRY_NO_SPEECH");
  assert.equal(decision.message, SPEECH_RETRY_MESSAGE);
});

test("retry gate marks very short recording", () => {
  const decision = evaluateSpeechRetryGate({
    transcript: "hi",
    metrics: { durationSec: 0.9, wordCount: 1, confidence: 0.9 },
  });
  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.reasonCode, "RETRY_TOO_SHORT");
});

test("retry gate marks whisper-like low confidence as too quiet", () => {
  const decision = evaluateSpeechRetryGate({
    transcript: "i maybe think so",
    metrics: { durationSec: 3.5, wordCount: 4, confidence: 0.24, speechRate: 80 },
  });
  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.reasonCode, "RETRY_TOO_QUIET");
});

test("retry gate marks mumble-like response as unintelligible", () => {
  const decision = evaluateSpeechRetryGate({
    transcript: "some words maybe okay",
    metrics: { durationSec: 6, wordCount: 4, confidence: 0.35, speechRate: 42 },
  });
  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.reasonCode, "RETRY_UNINTELLIGIBLE");
});

test("retry gate keeps normal response", () => {
  const decision = evaluateSpeechRetryGate({
    transcript: "I love reading after school and I discuss stories with my friends.",
    metrics: { durationSec: 18, wordCount: 12, confidence: 0.82, speechRate: 108, accuracy: 74 },
  });
  assert.equal(decision.shouldRetry, false);
  assert.equal(decision.reasonCode, null);
});

test("retry gate avoids false positive with strong pronunciation signal", () => {
  const decision = evaluateSpeechRetryGate({
    transcript: "I can explain this clearly now",
    metrics: {
      durationSec: 4,
      wordCount: 6,
      confidence: 0.2,
      speechRate: 52,
      pronunciationTargetRef: 72,
    },
  });
  assert.equal(decision.shouldRetry, false);
  assert.equal(decision.reasonCode, null);
});
