import test from "node:test";
import assert from "node:assert/strict";
import { computePlacementResult, getPlacementQuestions, scorePlacementAnswer } from "./placement";

test("placement questions cover all core skills", () => {
  const questions = getPlacementQuestions();
  const skills = new Set(questions.map((question) => question.skillKey));
  assert.ok(skills.has("pronunciation"));
  assert.ok(skills.has("fluency"));
  assert.ok(skills.has("tempo_control"));
  assert.ok(skills.has("vocabulary"));
  assert.ok(skills.has("task_completion"));
  assert.ok(questions.length >= 5);
});

test("placement scoring uses observed metrics when available", () => {
  const questions = getPlacementQuestions();
  const pronQuestion = questions.find((question) => question.skillKey === "pronunciation");
  assert.ok(pronQuestion);
  const score = scorePlacementAnswer(pronQuestion!, {
    questionId: pronQuestion!.id,
    observedMetrics: {
      pronunciation: 93,
      speechScore: 81,
      taskScore: 67,
      languageScore: 65,
    },
    transcript: "bad transcript should not dominate",
    selfRating: 1,
  });
  assert.equal(score, 93);
});

test("placement tempo scoring maps speechRate into stable bands", () => {
  const questions = getPlacementQuestions();
  const tempoQuestion = questions.find((question) => question.skillKey === "tempo_control");
  assert.ok(tempoQuestion);
  const high = scorePlacementAnswer(tempoQuestion!, {
    questionId: tempoQuestion!.id,
    observedMetrics: { speechRate: 120 },
  });
  const medium = scorePlacementAnswer(tempoQuestion!, {
    questionId: tempoQuestion!.id,
    observedMetrics: { speechRate: 95 },
  });
  const low = scorePlacementAnswer(tempoQuestion!, {
    questionId: tempoQuestion!.id,
    observedMetrics: { speechRate: 190 },
  });
  assert.equal(high, 85);
  assert.equal(medium, 72);
  assert.equal(low, 56);
});

test("placement scoring falls back to transcript length + self rating", () => {
  const questions = getPlacementQuestions();
  const fluencyQuestion = questions.find((question) => question.skillKey === "fluency");
  assert.ok(fluencyQuestion);

  const shortLow = scorePlacementAnswer(fluencyQuestion!, {
    questionId: fluencyQuestion!.id,
    transcript: "hi",
    selfRating: 1,
  });
  const longerHigh = scorePlacementAnswer(fluencyQuestion!, {
    questionId: fluencyQuestion!.id,
    transcript: "My name is Amina and I like drawing and reading with friends after school.",
    selfRating: 5,
  });

  assert.ok(shortLow < longerHigh);
  assert.ok(longerHigh >= 70);
});

test("computePlacementResult derives stage/confidence from mixed responses", () => {
  const result = computePlacementResult({
    intro: {
      questionId: "intro",
      observedMetrics: { fluency: 78, speechScore: 76, taskScore: 74, languageScore: 72 },
    },
    vocab: {
      questionId: "vocab",
      observedMetrics: { vocabularyUsage: 82, languageScore: 80 },
    },
    tempo: {
      questionId: "tempo",
      observedMetrics: { speechRate: 118 },
    },
    task: {
      questionId: "task",
      observedMetrics: { taskCompletion: 79, taskScore: 79 },
    },
    pron: {
      questionId: "pron",
      observedMetrics: { pronunciation: 88, speechScore: 85 },
    },
  });

  assert.equal(result.stage, "B2");
  assert.ok(result.average >= 80);
  assert.ok(result.confidence >= 0.7);
  assert.equal(Object.keys(result.skillSnapshot).length, 5);
});
