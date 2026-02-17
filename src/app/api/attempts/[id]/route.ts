import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { SpeechMetrics } from "@/lib/scoring";
import { config } from "@/lib/config";
import { ATTEMPT_STATUS, isAttemptRetryStatus } from "@/lib/attemptStatus";

type AttemptRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: AttemptRouteContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attempt = await prisma.attempt.findFirst({
    where: { id, studentId: student.studentId },
    include: {
      causalDiagnosis: true,
      task: {
        include: {
          taskInstance: {
            include: {
              decisionLog: {
                select: {
                  id: true,
                  selectionReason: true,
                  primaryGoal: true,
                  expectedGain: true,
                  estimatedDifficulty: true,
                },
              },
            },
          },
        },
      },
      gseEvidence: {
        include: {
          node: {
            select: {
              nodeId: true,
              descriptor: true,
              metadataJson: true,
              gseCenter: true,
              skill: true,
              type: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      },
    },
  });

  if (!attempt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const metrics = (attempt.speechMetricsJson || {}) as SpeechMetrics;
  const scores = (attempt.scoresJson || {}) as {
    speechScore?: number | null;
    taskScore?: number | null;
    languageScore?: number | null;
    overallScore?: number | null;
    reliability?: "high" | "medium" | "low";
  };
  const feedback = (attempt.feedbackJson || null) as {
    summary?: string;
    whatWentWell?: string[];
    whatToFixNow?: string[];
    exampleBetterAnswer?: string;
    nextMicroTask?: string;
  } | null;
  const taskEvaluation = (attempt.taskEvaluationJson || null) as {
    taskType?: string;
    taskScore?: number;
    artifacts?: Record<string, unknown>;
    rubricChecks?: Array<{ name?: string; pass?: boolean; reason?: string; weight?: number }>;
    loChecks?: Array<{
      checkId?: string;
      label?: string;
      pass?: boolean;
      confidence?: number;
      severity?: string;
      evidenceSpan?: string;
    }>;
    grammarChecks?: Array<{
      checkId?: string;
      label?: string;
      pass?: boolean;
      confidence?: number;
      opportunityType?: string;
      errorType?: string;
      evidenceSpan?: string;
      correction?: string;
    }>;
    evidence?: string[];
    modelVersion?: string;
  } | null;
  const grammarAccuracy =
    typeof taskEvaluation?.artifacts?.grammarAccuracy === "number"
      ? taskEvaluation.artifacts.grammarAccuracy
      : undefined;
  const coherenceScore =
    typeof taskEvaluation?.artifacts?.coherenceScore === "number"
      ? taskEvaluation.artifacts.coherenceScore
      : undefined;
  const argumentScore =
    typeof taskEvaluation?.artifacts?.argumentScore === "number"
      ? taskEvaluation.artifacts.argumentScore
      : undefined;

  const visibleMetrics = [
    {
      key: "overallScore",
      label: "Overall",
      value: scores.overallScore,
      kind: "score",
    },
    {
      key: "speechScore",
      label: "Speech",
      value: scores.speechScore,
      kind: "score",
    },
    {
      key: "taskScore",
      label: "Task completion",
      value: scores.taskScore,
      kind: "score",
    },
    {
      key: "languageScore",
      label: "Language",
      value: scores.languageScore,
      kind: "score",
    },
    {
      key: "grammarAccuracy",
      label: "Grammar",
      value: grammarAccuracy,
      kind: "score",
    },
    {
      key: "coherenceScore",
      label: "Coherence",
      value: coherenceScore,
      kind: "score",
    },
    {
      key: "argumentScore",
      label: "Argument",
      value: argumentScore,
      kind: "score",
    },
    {
      key: "vocabWords",
      label: "Target words used",
      value: Array.isArray(taskEvaluation?.artifacts?.requiredWordsUsed)
        ? taskEvaluation?.artifacts?.requiredWordsUsed.length
        : undefined,
      kind: "count",
    },
    {
      key: "speechRate",
      label: "Tempo (wpm)",
      value: metrics.speechRate,
      kind: "number",
    },
    {
      key: "tempoStability",
      label: "Tempo stability",
      value: metrics.tempoStability,
      kind: "score",
    },
    {
      key: "fillerCount",
      label: "Fillers",
      value: metrics.fillerCount,
      kind: "count",
    },
    {
      key: "durationSec",
      label: "Duration (sec)",
      value: metrics.durationSec ?? attempt.durationSec,
      kind: "number",
    },
    {
      key: "accuracy",
      label: "Pronunciation (target)",
      value: metrics.pronunciationTargetRef ?? metrics.accuracy,
      kind: "score",
    },
    {
      key: "selfRefPronunciation",
      label: "Pronunciation (self)",
      value: metrics.pronunciationSelfRef,
      kind: "score",
    },
    {
      key: "accuracyRaw",
      label: "Accuracy",
      value: metrics.accuracy,
      kind: "score",
    },
    {
      key: "fluency",
      label: "Fluency",
      value: metrics.fluency,
      kind: "score",
    },
    {
      key: "completeness",
      label: "Completeness",
      value: metrics.completeness,
      kind: "score",
    },
    {
      key: "prosody",
      label: "Prosody",
      value: metrics.prosody,
      kind: "score",
    },
    {
      key: "confidence",
      label: "Confidence",
      value: typeof metrics.confidence === "number" ? Math.round(metrics.confidence * 100) : undefined,
      kind: "score",
    },
  ].filter((item) => typeof item.value === "number");

  const speech = {
    pronunciationTargetRef: metrics.pronunciationTargetRef,
    pronunciationSelfRef: metrics.pronunciationSelfRef,
    accuracy: metrics.accuracy,
    fluency: metrics.fluency,
    completeness: metrics.completeness,
    prosody: metrics.prosody,
    confidence: metrics.confidence,
    speechRate: metrics.speechRate,
    fillerCount: metrics.fillerCount,
    pauseCount: metrics.pauseCount,
    durationSec: metrics.durationSec ?? attempt.durationSec ?? undefined,
    wordCount: metrics.wordCount,
    provider: config.speech.provider,
  };
  const gseEvidence = attempt.gseEvidence.map((row) => {
    const meta = row.node.metadataJson as Record<string, unknown> | null;
    const fallbackLabel =
      (meta && typeof meta.label === "string" && meta.label) ||
      (meta && typeof meta.name === "string" && meta.name) ||
      (row.node.type === "GSE_GRAMMAR" ? "Grammar pattern" : "GSE item");
    const descriptor =
      row.node.descriptor && row.node.descriptor.trim().length > 0
        ? row.node.descriptor
        : fallbackLabel;

    return {
      nodeId: row.nodeId,
      signal: row.signalType,
      evidenceKind: row.evidenceKind,
      opportunityType: row.opportunityType,
      score: row.score,
      confidence: row.confidence,
      weight: row.weight,
      source: row.source,
      domain: row.domain,
      usedForPromotion: row.usedForPromotion,
      targeted: row.targeted,
      activationImpact: row.activationImpact,
      evidenceText: row.evidenceText,
      metadataJson: row.metadataJson,
      descriptor,
      gseCenter: row.node.gseCenter,
      skill: row.node.skill,
      type: row.node.type,
    };
  });
  const evidenceMatrix = gseEvidence.map((row) => ({
    nodeId: row.nodeId,
    nodeLabel: row.descriptor,
    domain: row.domain,
    kind: row.evidenceKind,
    opportunityType: row.opportunityType,
    score: row.score,
    confidence: row.confidence,
    weight: row.weight,
    source: row.source,
    usedForPromotion: row.usedForPromotion,
    targeted: row.targeted,
    activationImpact: row.activationImpact,
    signal: row.signal,
    consistencyFlag:
      row.metadataJson && typeof row.metadataJson === "object"
        ? (row.metadataJson as Record<string, unknown>).consistencyFlag || null
        : null,
  }));
  const consistencyFlag = evidenceMatrix.some((row) => row.consistencyFlag)
    ? "inconsistent_lo_signal_repaired"
    : null;
  const language = {
    grammar: {
      grammarAccuracy,
      errorCountByType:
        (taskEvaluation?.artifacts?.errorCountByType as Record<string, number> | undefined) || null,
      topErrors:
        (taskEvaluation?.artifacts?.topErrors as Array<Record<string, unknown>> | undefined) || [],
    },
    discourse: {
      coherenceScore,
      argumentScore,
      registerScore:
        typeof taskEvaluation?.artifacts?.registerScore === "number"
          ? taskEvaluation.artifacts.registerScore
          : undefined,
    },
  };
  const nodeOutcomes = Array.isArray(attempt.nodeOutcomesJson)
    ? (attempt.nodeOutcomesJson as Array<{
        nodeId: string;
        deltaMastery: number;
        decayImpact: number;
        reliability: "high" | "medium" | "low";
        evidenceCount: number;
        alphaBefore?: number;
        alphaAfter?: number;
        betaBefore?: number;
        betaAfter?: number;
        activationStateBefore?: "observed" | "candidate_for_verification" | "verified";
        activationStateAfter?: "observed" | "candidate_for_verification" | "verified";
        activationImpact?: "none" | "observed" | "candidate" | "verified";
        verificationDueAt?: string | null;
      }>)
    : [];
  const incidentalFindings = evidenceMatrix
    .filter((row) => row.targeted === false)
    .slice(0, 20);
  const activationTransitions = nodeOutcomes
    .filter((row) => row.activationImpact && row.activationImpact !== "none")
    .map((row) => ({
      nodeId: row.nodeId,
      activationStateBefore: row.activationStateBefore || null,
      activationStateAfter: row.activationStateAfter || null,
      activationImpact: row.activationImpact,
      verificationDueAt: row.verificationDueAt || null,
    }));

  const isFailed = attempt.status === ATTEMPT_STATUS.FAILED;
  const isRetry = isAttemptRetryStatus(attempt.status);
  const causal = attempt.causalDiagnosis
    ? {
        taxonomyVersion: attempt.causalDiagnosis.taxonomyVersion,
        modelVersion: attempt.causalDiagnosis.modelVersion,
        topLabel: attempt.causalDiagnosis.topLabel,
        topProbability: attempt.causalDiagnosis.topProbability,
        entropy: attempt.causalDiagnosis.entropy,
        topMargin: attempt.causalDiagnosis.topMargin,
        distribution:
          Array.isArray(attempt.causalDiagnosis.distributionJson) &&
          attempt.causalDiagnosis.distributionJson.length > 0
            ? attempt.causalDiagnosis.distributionJson
            : [],
        confidenceInterval:
          attempt.causalDiagnosis.confidenceIntervalJson &&
          typeof attempt.causalDiagnosis.confidenceIntervalJson === "object"
            ? attempt.causalDiagnosis.confidenceIntervalJson
            : null,
        counterfactual:
          attempt.causalDiagnosis.counterfactualJson &&
          typeof attempt.causalDiagnosis.counterfactualJson === "object"
            ? attempt.causalDiagnosis.counterfactualJson
            : null,
        createdAt: attempt.causalDiagnosis.createdAt,
      }
    : null;

  return NextResponse.json({
    status: attempt.status,
    flow: {
      isPlacement: Boolean((attempt.task.metaJson as { isPlacement?: boolean } | null)?.isPlacement),
      placementSessionId:
        ((attempt.task.metaJson as { placementSessionId?: string } | null)?.placementSessionId) || null,
    },
    error:
      isFailed || isRetry
        ? {
            code: attempt.errorCode,
            message: attempt.errorMessage,
          }
        : null,
    retry: isRetry
      ? {
          required: true,
          reasonCode: attempt.errorCode,
          message: attempt.errorMessage,
        }
      : null,
    results:
      attempt.status === ATTEMPT_STATUS.COMPLETED
        ? {
            transcript: attempt.transcript,
            speech,
            language,
            scores,
            taskEvaluation,
            feedback,
            causal,
            gseEvidence,
            evidenceMatrix,
            consistencyFlag,
            incidentalFindings,
            activationTransitions,
            nodeOutcomes,
            recoveryTriggered: attempt.recoveryTriggered,
            planner: attempt.task.taskInstance?.decisionLog
              ? {
                  decisionId: attempt.task.taskInstance.decisionLog.id,
                  selectionReason: attempt.task.taskInstance.decisionLog.selectionReason,
                  primaryGoal: attempt.task.taskInstance.decisionLog.primaryGoal,
                  expectedGain: attempt.task.taskInstance.decisionLog.expectedGain,
                  estimatedDifficulty: attempt.task.taskInstance.decisionLog.estimatedDifficulty,
                }
              : null,
            visibleMetrics,
            debug: config.worker.showAiDebug ? attempt.aiDebugJson : null,
          }
        : null,
  });
}
