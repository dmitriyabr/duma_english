import { z } from "zod";

const anyRecordSchema = z.record(z.string(), z.unknown());

export const taskNextResponseSchema = z
  .object({
    taskId: z.string(),
    type: z.string(),
    prompt: z.string(),
    assessmentMode: z.string(),
    maxDurationSec: z.number(),
    constraints: z
      .object({
        minSeconds: z.number().optional(),
        maxSeconds: z.number().optional(),
      })
      .nullable()
      .optional(),
    stage: z.string(),
    placementStage: z.string(),
    ageBand: z.string(),
    reason: z.string(),
    targetSkills: z.array(z.string()),
    targetWords: z.array(z.string()),
    recommendedTaskTypes: z.array(z.string()),
    placementFresh: z.boolean(),
    coldStartActive: z.boolean(),
    coldStartAttempts: z.number(),
    placementUncertainNodes: z.array(z.string()),
    carryoverSummary: z.unknown().nullable(),
    diagnosticMode: z.boolean(),
    decisionId: z.string(),
    primaryGoal: z.string().nullable().optional(),
    selectionReasonType: z.string().nullable().optional(),
    verificationTargetNodeIds: z.array(z.string()),
    domainsTargeted: z.array(z.string()),
    rotationApplied: z.boolean(),
    rotationReason: z.string().nullable().optional(),
    difficulty: z.number().nullable().optional(),
    expectedGain: z.number().nullable().optional(),
    similarityToRecent: z.number(),
    fallbackUsed: z.boolean(),
    fallbackReason: z.string().nullable(),
    correctivePolicyDomain: z.string().nullable().optional(),
    targetNodeIds: z.array(z.string()),
    targetNodeLabels: z.array(
      z.object({
        nodeId: z.string(),
        label: z.string(),
      })
    ),
    selectionReason: z.string(),
  })
  .passthrough();

export const attemptDetailsResponseSchema = z
  .object({
    status: z.string(),
    flow: z.object({
      isPlacement: z.boolean(),
      placementSessionId: z.string().nullable(),
    }),
    error: z
      .object({
        code: z.string().nullable(),
        message: z.string().nullable(),
      })
      .nullable(),
    retry: z
      .object({
        required: z.literal(true),
        reasonCode: z.string().nullable(),
        message: z.string().nullable(),
      })
      .nullable()
      .optional(),
    results: z
      .object({
        transcript: z.string().nullable(),
        speech: anyRecordSchema,
        language: anyRecordSchema,
        scores: anyRecordSchema,
        taskEvaluation: anyRecordSchema.nullable(),
        feedback: z.unknown().nullable(),
        causal: z
          .object({
            taxonomyVersion: z.string(),
            modelVersion: z.string(),
            topLabel: z.string(),
            topProbability: z.number(),
            entropy: z.number().nullable(),
            topMargin: z.number().nullable(),
            distribution: z.array(z.unknown()),
            confidenceInterval: z.unknown().nullable(),
            counterfactual: z.unknown().nullable(),
            createdAt: z.coerce.date(),
          })
          .nullable(),
        gseEvidence: z.array(z.unknown()),
        evidenceMatrix: z.array(z.unknown()),
        consistencyFlag: z.string().nullable(),
        incidentalFindings: z.array(z.unknown()),
        activationTransitions: z.array(z.unknown()),
        nodeOutcomes: z.array(z.unknown()),
        recoveryTriggered: z.boolean(),
        planner: z.unknown().nullable(),
        visibleMetrics: z.array(z.unknown()),
        debug: z.unknown().nullable(),
      })
      .nullable(),
  })
  .passthrough();

export const progressResponseSchema = z
  .object({
    stage: z.string(),
    placementStage: z.string(),
    promotionStage: z.string(),
    placementUncertainty: z.number(),
    placementConfidence: z.number().nullable().optional(),
    placementFresh: z.boolean(),
    streak: z.number(),
    skills: z.array(z.unknown()),
    nodeProgress: z
      .object({
        masteredNodes: z.number(),
        inProgressNodes: z.number(),
        observedNodesCount: z.number(),
        candidateNodesCount: z.number(),
        verifiedNodesCount: z.number(),
        nextTargetNodes: z.array(z.unknown()),
        delta7: z.number(),
        delta28: z.number(),
        coverage7: z.number(),
        coverage28: z.number(),
        verificationQueue: z.array(z.unknown()),
      })
      .passthrough(),
    promotionReadiness: z
      .object({
        currentStage: z.string(),
        targetStage: z.string(),
        ready: z.boolean(),
        readinessScore: z.number(),
      })
      .passthrough(),
  })
  .passthrough();

export const teacherClassResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.coerce.date(),
    students: z.array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        createdAt: z.coerce.date(),
        loginCode: z.string().nullable(),
        lastAttemptAt: z.coerce.date().nullable(),
        lastScore: z.number().nullable().optional(),
        stage: z.string(),
      })
    ),
    codes: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        expiresAt: z.coerce.date().nullable(),
        usesCount: z.number(),
        maxUses: z.number().nullable(),
      })
    ),
  })
  .passthrough();

export const placementStartResponseSchema = z
  .object({
    placementId: z.string(),
    status: z.string(),
    theta: z.number(),
    sigma: z.number(),
    currentIndex: z.number(),
    totalQuestions: z.number(),
    currentQuestion: z.unknown().nullable(),
    nextItem: z.unknown().nullable(),
  })
  .passthrough();

export const placementAnswerResponseSchema = z
  .object({
    placementId: z.string(),
    status: z.string(),
    theta: z.number(),
    sigma: z.number(),
    currentIndex: z.number(),
    questionCount: z.number(),
    totalQuestions: z.number(),
    nextItem: z.unknown().nullable(),
    whyThisItem: z.string().nullable(),
    done: z.boolean(),
  })
  .passthrough();

export const placementFinishResponseSchema = z
  .object({
    placementId: z.string(),
    status: z.string(),
    result: z
      .object({
        stage: z.string(),
        provisionalStage: z.string(),
        promotionStage: z.string(),
        confidence: z.number(),
        uncertainty: z.number(),
      })
      .passthrough(),
    provisionalStage: z.string(),
    promotionStage: z.string(),
    confidence: z.number(),
    uncertainty: z.number(),
    coverage: z.number().nullable(),
    reliability: z.number().nullable(),
    blockedBundles: z.array(z.unknown()),
  })
  .passthrough();

export const placementExtendedStartResponseSchema = z
  .object({
    sessionId: z.string(),
    task: z.object({
      taskId: z.string(),
      type: z.string(),
      prompt: z.string(),
      metaJson: z.unknown().nullable().optional(),
    }),
  })
  .passthrough();

export const placementExtendedSubmitResponseSchema = z.union([
  z
    .object({
      finished: z.literal(false),
      nextTask: z.object({
        taskId: z.string(),
        type: z.string(),
        prompt: z.string(),
        metaJson: z.unknown().nullable().optional(),
      }),
    })
    .passthrough(),
  z
    .object({
      finished: z.literal(true),
      reason: z.string(),
      result: z.object({
        stage: z.string(),
        confidence: z.number(),
      }).passthrough(),
    })
    .passthrough(),
]);

export const placementExtendedResetResponseSchema = z
  .object({
    ok: z.boolean(),
  })
  .passthrough();
