import test from "node:test";
import assert from "node:assert/strict";
import { buildOpportunityEvidence } from "./gse/evidence";

test("read_aloud does not emit direct vocab mastery evidence", () => {
  const result = buildOpportunityEvidence({
    taskType: "read_aloud",
    taskPrompt: "Read this aloud clearly: 'I learn English every day at school.'",
    transcript: "I learn English every day at school.",
    derivedMetrics: {},
    taskEvaluation: {
      taskScore: 90,
      artifacts: { referenceCoverage: 100 },
      rubricChecks: [{ pass: true, weight: 1 }],
    },
    scoreReliability: "high",
    taskTargets: [
      {
        nodeId: "gse:vocab:school",
        weight: 1,
        required: true,
        node: {
          nodeId: "gse:vocab:school",
          type: "GSE_VOCAB",
          sourceKey: "school",
          descriptor: "Can use the word school in context.",
          skill: "vocabulary",
          metadataJson: null,
        },
      },
    ],
  });

  const vocabRows = result.created.filter((row) => row.domain === "vocab");
  assert.ok(vocabRows.length > 0);
  assert.equal(vocabRows.some((row) => row.evidenceKind === "direct"), false);
  assert.equal(vocabRows.some((row) => row.usedForPromotion), false);
});

test("spontaneous grammar can produce direct grammar evidence", () => {
  const result = buildOpportunityEvidence({
    taskType: "topic_talk",
    taskPrompt: "Talk about your school day.",
    transcript:
      "Yesterday I had finished my homework before I went to school, and I would help my friend if he asked.",
    derivedMetrics: {},
    taskEvaluation: {
      taskScore: 78,
      artifacts: {},
      rubricChecks: [{ pass: true, weight: 1 }],
      grammarChecks: [
        {
          checkId: "grammar_present_perfect_usage",
          descriptorId: "complex_tense",
          label: "Present perfect used correctly",
          pass: true,
          confidence: 0.81,
          opportunityType: "incidental",
        },
      ],
    },
    scoreReliability: "medium",
    taskTargets: [
      {
        nodeId: "gse:grammar:complex_tense",
        weight: 1,
        required: false,
        node: {
          nodeId: "gse:grammar:complex_tense",
          type: "GSE_GRAMMAR",
          sourceKey: "complex_tense",
          descriptor: "Can use mixed complex tenses in narration.",
          skill: "grammar",
          metadataJson: null,
        },
      },
    ],
  });

  const grammar = result.created.find((row) => row.domain === "grammar");
  assert.ok(grammar);
  assert.equal(grammar?.evidenceKind, "direct");
  assert.ok((grammar?.score || 0) > 0.6);
});

test("target vocab matching uses descriptor when sourceKey is technical id", () => {
  const result = buildOpportunityEvidence({
    taskType: "target_vocab",
    taskPrompt: "Use this word in your answer: school.",
    transcript: "I go to school every day and I like my school.",
    derivedMetrics: {},
    taskEvaluation: {
      taskScore: 85,
      artifacts: {},
      rubricChecks: [{ pass: true, weight: 1 }],
    },
    scoreReliability: "high",
    taskTargets: [
      {
        nodeId: "gse:vocab:school",
        weight: 1,
        required: true,
        node: {
          nodeId: "gse:vocab:school",
          type: "GSE_VOCAB",
          sourceKey: "ua8444abd28d0e715.-5299d1a3.145b71b45b7.4aad",
          descriptor: "school",
          skill: "vocabulary",
          metadataJson: null,
        },
      },
    ],
  });

  const vocab = result.created.find((row) => row.domain === "vocab");
  assert.ok(vocab);
  assert.equal(vocab?.evidenceKind, "direct");
  assert.equal(vocab?.signalType, "vocab_target_used");
});

test("age-band calibration lowers incidental grammar weight for 6-8 vs 12-14", () => {
  const baseInput = {
    taskType: "read_aloud",
    taskPrompt: "Read this aloud clearly: 'I go to school every day.'",
    transcript: "I go to school every day.",
    derivedMetrics: {},
    taskEvaluation: {
      taskScore: 80,
      artifacts: {},
      rubricChecks: [{ pass: true, weight: 1 }],
      grammarChecks: [
        {
          checkId: "grammar_present_simple",
          descriptorId: "present_simple",
          label: "Present simple in context",
          pass: true,
          confidence: 0.74,
          opportunityType: "incidental",
        },
      ],
    },
    scoreReliability: "medium" as const,
    taskTargets: [
      {
        nodeId: "gse:grammar:present_simple",
        weight: 1,
        required: true,
        node: {
          nodeId: "gse:grammar:present_simple",
          type: "GSE_GRAMMAR" as const,
          sourceKey: "present_simple",
          descriptor: "Can use present simple in short statements.",
          skill: "grammar",
          metadataJson: null,
        },
      },
    ],
  };

  const young = buildOpportunityEvidence({ ...baseInput, ageBand: "6-8" });
  const older = buildOpportunityEvidence({ ...baseInput, ageBand: "12-14" });
  const youngWeight = young.created.find((row) => row.domain === "grammar")?.weight || 0;
  const olderWeight = older.created.find((row) => row.domain === "grammar")?.weight || 0;
  assert.ok(youngWeight > 0);
  assert.ok(olderWeight > 0);
  assert.ok(youngWeight < olderWeight);
});

test("low task score enforces explicit negative LO evidence", () => {
  const result = buildOpportunityEvidence({
    taskType: "qa_prompt",
    taskPrompt: "Answer the question in full sentences.",
    transcript: "Yes.",
    derivedMetrics: {},
    taskEvaluation: {
      taskScore: 30,
      artifacts: {},
      rubricChecks: [{ pass: true, weight: 1 }],
      loChecks: [{ checkId: "lo_main", label: "Main objective met", pass: true, confidence: 0.8, severity: "low" }],
    },
    scoreReliability: "medium",
    taskTargets: [
      {
        nodeId: "gse:lo:answer_question",
        weight: 1,
        required: true,
        node: {
          nodeId: "gse:lo:answer_question",
          type: "GSE_LO",
          sourceKey: "answer_question",
          descriptor: "Can answer a question with supporting detail.",
          skill: "speaking",
          metadataJson: null,
        },
      },
    ],
    ageBand: "9-11",
  });

  const loNegatives = result.created.filter(
    (row) => row.domain === "lo" && row.evidenceKind === "negative" && row.opportunityType === "explicit_target"
  );
  assert.ok(loNegatives.length >= 1);
  assert.ok(loNegatives.some((row) => row.signalType === "lo_check_negative_required"));
});

test("high task score with positive LO checks does not force negative LO evidence", () => {
  const result = buildOpportunityEvidence({
    taskType: "qa_prompt",
    taskPrompt: "Answer the question in full sentences.",
    transcript: "I usually study after school because it helps me prepare.",
    derivedMetrics: {},
    taskEvaluation: {
      taskScore: 88,
      artifacts: {},
      rubricChecks: [{ pass: true, weight: 1 }],
      loChecks: [{ checkId: "lo_main", label: "Main objective met", pass: true, confidence: 0.9, severity: "low" }],
    },
    scoreReliability: "high",
    taskTargets: [
      {
        nodeId: "gse:lo:answer_question",
        weight: 1,
        required: true,
        node: {
          nodeId: "gse:lo:answer_question",
          type: "GSE_LO",
          sourceKey: "answer_question",
          descriptor: "Can answer a question with supporting detail.",
          skill: "speaking",
          metadataJson: null,
        },
      },
    ],
    ageBand: "12-14",
  });

  const forcedNegative = result.created.find((row) => row.signalType === "lo_check_negative_required");
  assert.equal(Boolean(forcedNegative), false);
});
