import assert from "node:assert/strict";
import test from "node:test";
import { inferCausalDiagnosis } from "./inference";

const baseInput = {
  attemptId: "att_1",
  studentId: "stu_1",
  taskType: "qa_prompt",
  transcript: "I like science because I learn many facts and I ask questions every day.",
  speechMetrics: {
    accuracy: 78,
    fluency: 74,
    completeness: 82,
    prosody: 70,
    confidence: 0.82,
    speechRate: 116,
    fillerCount: 1,
    pauseCount: 3,
    durationSec: 22,
    wordCount: 16,
  },
  taskEvaluation: {
    taskType: "qa_prompt",
    taskScore: 72,
    languageScore: 70,
    artifacts: {
      grammarAccuracy: 68,
      requiredWordsUsed: ["science"],
      missingWords: [],
    },
    rubricChecks: [
      { name: "task", pass: true, reason: "on-topic", weight: 0.5 },
      { name: "clarity", pass: true, reason: "clear", weight: 0.5 },
    ],
    loChecks: [{ checkId: "lo_1", label: "objective", pass: true, confidence: 0.8, severity: "low" as const }],
    grammarChecks: [
      {
        checkId: "gr_1",
        label: "present simple",
        pass: true,
        confidence: 0.74,
        opportunityType: "incidental" as const,
      },
    ],
    vocabChecks: [],
    evidence: ["sample"],
    modelVersion: "eval-v2",
  },
  scores: {
    taskScore: 72,
    languageScore: 70,
    overallScore: 73,
    reliability: "medium" as const,
  },
};

test("causal inference produces normalized distribution and interval", () => {
  const diagnosis = inferCausalDiagnosis(baseInput);
  const total = diagnosis.distribution.reduce((sum, row) => sum + row.p, 0);

  assert.equal(diagnosis.modelVersion, "causal-inference-v1");
  assert.equal(Number(total.toFixed(4)), 1);
  assert.ok(diagnosis.topProbability >= 0 && diagnosis.topProbability <= 1);
  assert.ok((diagnosis.confidenceInterval?.lower ?? 0) <= (diagnosis.confidenceInterval?.upper ?? 1));
});

test("low grammar quality shifts top cause toward rule confusion", () => {
  const diagnosis = inferCausalDiagnosis({
    ...baseInput,
    taskEvaluation: {
      ...baseInput.taskEvaluation,
      taskScore: 46,
      artifacts: {
        ...baseInput.taskEvaluation.artifacts,
        grammarAccuracy: 34,
      },
      grammarChecks: [
        {
          checkId: "gr_fail_1",
          label: "verb agreement",
          pass: false,
          confidence: 0.88,
          opportunityType: "incidental",
        },
        {
          checkId: "gr_fail_2",
          label: "tense",
          pass: false,
          confidence: 0.84,
          opportunityType: "incidental",
        },
      ],
    },
  });

  assert.equal(diagnosis.topLabel, "rule_confusion");
  assert.ok(diagnosis.topProbability >= 0.2);
});

test("strong task miss with good grammar shifts top cause toward instruction misread", () => {
  const diagnosis = inferCausalDiagnosis({
    ...baseInput,
    transcript: "I talked about my hobby and my friend, not the requested question.",
    taskEvaluation: {
      ...baseInput.taskEvaluation,
      taskScore: 32,
      artifacts: {
        ...baseInput.taskEvaluation.artifacts,
        grammarAccuracy: 81,
      },
      loChecks: [
        { checkId: "lo_fail", label: "main objective", pass: false, confidence: 0.91, severity: "high" },
      ],
      grammarChecks: [
        {
          checkId: "gr_ok",
          label: "grammar",
          pass: true,
          confidence: 0.81,
          opportunityType: "incidental",
        },
      ],
    },
  });

  assert.equal(diagnosis.topLabel, "instruction_misread");
});
