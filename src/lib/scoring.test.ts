import test from "node:test";
import assert from "node:assert/strict";
import { composeScores, computeSpeechScore, stageWeights } from "./scoring";

test("stageWeights transitions are correct", () => {
  assert.deepEqual(stageWeights(1), { speech: 0.6, task: 0.25, language: 0.15 });
  assert.deepEqual(stageWeights(20), { speech: 0.45, task: 0.35, language: 0.2 });
  assert.deepEqual(stageWeights(40), { speech: 0.35, task: 0.4, language: 0.25 });
});

test("computeSpeechScore uses high reliability when PA is available", () => {
  const result = computeSpeechScore({
    pronunciationTargetRef: 92.4,
    accuracy: 93,
    fluency: 99,
    completeness: 100,
    prosody: 85.1,
  });
  assert.equal(result.reliability, "high");
  assert.ok((result.score || 0) >= 90);
});

test("computeSpeechScore falls back to derived signals", () => {
  const result = computeSpeechScore({
    speechRate: 126,
    fillerCount: 1,
    pauseCount: 4,
    durationSec: 24,
    wordCount: 52,
    confidence: 0.84,
  });
  assert.equal(result.reliability, "medium");
  assert.ok((result.score || 0) >= 60);
});

test("composeScores includes language score and computes overall", () => {
  const score = composeScores({
    metrics: {
      pronunciationTargetRef: 92,
      accuracy: 90,
      fluency: 94,
      completeness: 96,
      prosody: 85,
    },
    taskScore: 88,
    languageScore: 80,
    attemptCount: 5,
  });

  assert.equal(score.speechScore, 91);
  assert.equal(score.taskScore, 88);
  assert.equal(score.languageScore, 80);
  assert.ok(score.overallScore !== null);
});

test("composeScores can hide overall when strict reliability is on", () => {
  const score = composeScores({
    metrics: { speechRate: 120 },
    taskScore: 72,
    languageScore: null,
    attemptCount: 2,
    strictReliabilityGating: true,
  });

  assert.equal(score.overallScore, null);
});
