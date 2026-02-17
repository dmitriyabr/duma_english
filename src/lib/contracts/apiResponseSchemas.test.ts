import assert from "node:assert/strict";
import test from "node:test";
import {
  attemptDetailsResponseSchema,
  placementAnswerResponseSchema,
  placementExtendedResetResponseSchema,
  placementExtendedStartResponseSchema,
  placementExtendedSubmitResponseSchema,
  placementFinishResponseSchema,
  placementStartResponseSchema,
  progressResponseSchema,
  taskNextResponseSchema,
  teacherClassResponseSchema,
} from "./apiResponseSchemas";

test("task next contract accepts current shape", () => {
  const parsed = taskNextResponseSchema.parse({
    taskId: "task_1",
    type: "topic_talk",
    prompt: "Tell me about your weekend.",
    assessmentMode: "stt",
    maxDurationSec: 120,
    constraints: { minSeconds: 20, maxSeconds: 120 },
    stage: "A2",
    placementStage: "A2",
    ageBand: "9-11",
    reason: "rotation",
    targetSkills: ["fluency"],
    targetWords: ["weekend"],
    recommendedTaskTypes: ["topic_talk", "qa_prompt"],
    placementFresh: false,
    coldStartActive: false,
    coldStartAttempts: 3,
    placementUncertainNodes: [],
    carryoverSummary: null,
    diagnosticMode: false,
    decisionId: "dec_1",
    primaryGoal: "maintain_progress",
    selectionReasonType: "planner",
    verificationTargetNodeIds: [],
    domainsTargeted: ["lo"],
    rotationApplied: true,
    rotationReason: "avoid_repeat",
    difficulty: 0.4,
    expectedGain: 0.2,
    similarityToRecent: 0.1,
    fallbackUsed: false,
    fallbackReason: null,
    correctivePolicyDomain: null,
    targetNodeIds: ["gse:1"],
    targetNodeLabels: [{ nodeId: "gse:1", label: "Can describe weekend activities" }],
    selectionReason: "planner_target",
  });
  assert.equal(parsed.taskId, "task_1");
});

test("attempt details contract accepts current shape", () => {
  const parsed = attemptDetailsResponseSchema.parse({
    status: "completed",
    flow: { isPlacement: false, placementSessionId: null },
    error: null,
    results: {
      transcript: "sample",
      speech: {},
      language: {},
      scores: {},
      taskEvaluation: {},
      feedback: {},
      gseEvidence: [],
      evidenceMatrix: [],
      consistencyFlag: null,
      incidentalFindings: [],
      activationTransitions: [],
      nodeOutcomes: [],
      recoveryTriggered: false,
      planner: null,
      visibleMetrics: [],
      debug: null,
    },
  });
  assert.equal(parsed.status, "completed");
});

test("attempt details contract accepts needs_retry shape", () => {
  const parsed = attemptDetailsResponseSchema.parse({
    status: "needs_retry",
    flow: { isPlacement: true, placementSessionId: "placement_1" },
    error: {
      code: "RETRY_TOO_QUIET",
      message: "I'm sorry, I didn't hear you well. Can you try again?",
    },
    retry: {
      required: true,
      reasonCode: "RETRY_TOO_QUIET",
      message: "I'm sorry, I didn't hear you well. Can you try again?",
    },
    results: null,
  });
  assert.equal(parsed.status, "needs_retry");
  assert.equal(parsed.retry?.required, true);
});

test("progress contract accepts current shape", () => {
  const parsed = progressResponseSchema.parse({
    stage: "A2",
    placementStage: "A2",
    promotionStage: "A2",
    placementUncertainty: 0.31,
    placementConfidence: 0.7,
    placementFresh: false,
    streak: 2,
    skills: [],
    nodeProgress: {
      masteredNodes: 2,
      inProgressNodes: 5,
      observedNodesCount: 4,
      candidateNodesCount: 1,
      verifiedNodesCount: 2,
      nextTargetNodes: [],
      delta7: 1,
      delta28: 2,
      coverage7: 4,
      coverage28: 8,
      verificationQueue: [],
    },
    promotionReadiness: {
      currentStage: "A2",
      targetStage: "B1",
      ready: false,
      readinessScore: 42,
    },
  });
  assert.equal(parsed.stage, "A2");
});

test("teacher class contract accepts current shape", () => {
  const parsed = teacherClassResponseSchema.parse({
    id: "class_1",
    name: "A",
    createdAt: new Date(),
    students: [
      {
        id: "student_1",
        displayName: "Kid",
        createdAt: new Date(),
        loginCode: "ABCD12",
        lastAttemptAt: null,
        lastScore: null,
        stage: "A1",
      },
    ],
    codes: [
      {
        id: "code_1",
        code: "QWER12",
        expiresAt: null,
        usesCount: 0,
        maxUses: null,
      },
    ],
  });
  assert.equal(parsed.students.length, 1);
});

test("placement endpoint contracts accept current shape", () => {
  placementStartResponseSchema.parse({
    placementId: "pl_1",
    status: "started",
    theta: 0,
    sigma: 1,
    currentIndex: 0,
    totalQuestions: 14,
    currentQuestion: null,
    nextItem: null,
  });

  placementAnswerResponseSchema.parse({
    placementId: "pl_1",
    status: "started",
    theta: 0.2,
    sigma: 0.9,
    currentIndex: 1,
    questionCount: 1,
    totalQuestions: 14,
    nextItem: null,
    whyThisItem: null,
    done: false,
  });

  placementFinishResponseSchema.parse({
    placementId: "pl_1",
    status: "completed",
    result: {
      stage: "A2",
      provisionalStage: "A2",
      promotionStage: "A2",
      confidence: 0.7,
      uncertainty: 0.3,
    },
    provisionalStage: "A2",
    promotionStage: "A2",
    confidence: 0.7,
    uncertainty: 0.3,
    coverage: 45,
    reliability: 50,
    blockedBundles: [],
  });

  placementExtendedStartResponseSchema.parse({
    sessionId: "ext_1",
    task: {
      taskId: "task_1",
      type: "topic_talk",
      prompt: "Tell me something",
      metaJson: {},
    },
  });

  placementExtendedSubmitResponseSchema.parse({
    finished: false,
    nextTask: {
      taskId: "task_2",
      type: "topic_talk",
      prompt: "Another prompt",
      metaJson: {},
    },
  });
  placementExtendedSubmitResponseSchema.parse({
    finished: true,
    reason: "maximum_6_attempts_reached",
    result: {
      stage: "B1",
      confidence: 0.66,
    },
  });

  placementExtendedResetResponseSchema.parse({ ok: true });
});
