import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { getObjectBuffer, deleteObject } from "../lib/storage";
import { analyzeSpeechFromBuffer } from "../lib/speech";
import { calculateDerivedSpeechMetrics, composeScores } from "../lib/scoring";
import { computeLanguageScoreFromTaskEvaluation, evaluateTaskQuality, type EvaluationInput } from "../lib/evaluator";
import { recomputeMastery } from "../lib/adaptive";
import { finishPlacement, submitPlacementAnswer } from "../lib/placement/irt";
import { persistAttemptGseEvidence } from "../lib/gse/evidence/persist";
import { config } from "../lib/config";

const POLL_INTERVAL_MS = config.worker.pollIntervalMs;
const SCORE_VERSION = "score-v3";

type MetricSource = "azure" | "rules" | "openai";
type MetricReliability = "high" | "medium" | "low";

type CanonicalMetric = {
  metricKey: string;
  value: number;
  source: MetricSource;
  reliability: MetricReliability;
};

function isTransientError(error: unknown) {
  const status = (error as { status?: number }).status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

function mapError(error: unknown) {
  if (error instanceof Error) {
    return {
      code: (error as Error & { code?: string }).code || "PROCESSING_ERROR",
      message: error.message.slice(0, 500),
    };
  }
  return { code: "PROCESSING_ERROR", message: "Unknown processing error" };
}

function roundMetric(value: number) {
  return Number(value.toFixed(2));
}

function toPercentConfidence(confidence: number | undefined) {
  if (typeof confidence !== "number") return null;
  return roundMetric(confidence * 100);
}

function extractVocabularyUsage(taskEvaluation: { artifacts?: Record<string, unknown>; taskScore?: number }) {
  const usage = taskEvaluation.artifacts?.wordUsageCorrectness;
  if (typeof usage === "number") return usage;
  return typeof taskEvaluation.taskScore === "number" ? taskEvaluation.taskScore : null;
}

function buildCanonicalMetrics(params: {
  derivedMetrics: ReturnType<typeof calculateDerivedSpeechMetrics>;
  taskEvaluation: { taskScore: number; artifacts?: Record<string, unknown> };
  languageScore: number;
}): CanonicalMetric[] {
  const { derivedMetrics, taskEvaluation, languageScore } = params;
  const grammarAccuracy =
    typeof taskEvaluation.artifacts?.grammarAccuracy === "number"
      ? taskEvaluation.artifacts.grammarAccuracy
      : null;
  const coherenceScore =
    typeof taskEvaluation.artifacts?.coherenceScore === "number"
      ? taskEvaluation.artifacts.coherenceScore
      : null;
  const argumentScore =
    typeof taskEvaluation.artifacts?.argumentScore === "number"
      ? taskEvaluation.artifacts.argumentScore
      : null;
  const registerScore =
    typeof taskEvaluation.artifacts?.registerScore === "number"
      ? taskEvaluation.artifacts.registerScore
      : null;
  const items: Array<CanonicalMetric | null> = [
    typeof derivedMetrics.speechRate === "number"
      ? { metricKey: "tempo_wpm", value: roundMetric(derivedMetrics.speechRate), source: "rules", reliability: "medium" }
      : null,
    typeof derivedMetrics.tempoStability === "number"
      ? { metricKey: "tempo_stability", value: roundMetric(derivedMetrics.tempoStability), source: "rules", reliability: "medium" }
      : null,
    typeof derivedMetrics.fillerDensityPer100 === "number"
      ? { metricKey: "filler_density_per100", value: roundMetric(derivedMetrics.fillerDensityPer100), source: "rules", reliability: "medium" }
      : null,
    typeof derivedMetrics.pauseDensityPerMin === "number"
      ? { metricKey: "pause_density_per_min", value: roundMetric(derivedMetrics.pauseDensityPerMin), source: "rules", reliability: "medium" }
      : null,
    typeof derivedMetrics.pronunciationTargetRef === "number"
      ? { metricKey: "pronunciation_target_ref", value: roundMetric(derivedMetrics.pronunciationTargetRef), source: "azure", reliability: "high" }
      : null,
    typeof derivedMetrics.pronunciationSelfRef === "number"
      ? { metricKey: "pronunciation_self_ref", value: roundMetric(derivedMetrics.pronunciationSelfRef), source: "azure", reliability: "medium" }
      : null,
    typeof derivedMetrics.fluency === "number"
      ? { metricKey: "fluency", value: roundMetric(derivedMetrics.fluency), source: "azure", reliability: "high" }
      : null,
    (() => {
      const vocab = extractVocabularyUsage(taskEvaluation);
      if (typeof vocab !== "number") return null;
      return { metricKey: "vocabulary_usage", value: roundMetric(vocab), source: "openai", reliability: "medium" };
    })(),
    { metricKey: "task_completion", value: roundMetric(taskEvaluation.taskScore), source: "openai", reliability: "medium" },
    typeof grammarAccuracy === "number"
      ? { metricKey: "grammar_accuracy", value: roundMetric(grammarAccuracy), source: "openai", reliability: "medium" }
      : null,
    typeof coherenceScore === "number"
      ? { metricKey: "coherence_score", value: roundMetric(coherenceScore), source: "openai", reliability: "medium" }
      : null,
    typeof argumentScore === "number"
      ? { metricKey: "argument_score", value: roundMetric(argumentScore), source: "openai", reliability: "medium" }
      : null,
    typeof registerScore === "number"
      ? { metricKey: "register_score", value: roundMetric(registerScore), source: "openai", reliability: "medium" }
      : null,
    (() => {
      const confidence = toPercentConfidence(derivedMetrics.confidence);
      if (confidence === null) return null;
      return { metricKey: "transcript_confidence", value: confidence, source: "azure", reliability: "high" };
    })(),
    { metricKey: "language_score", value: roundMetric(languageScore), source: "openai", reliability: "medium" },
  ];

  return items.filter((item): item is CanonicalMetric => item !== null);
}

async function updateStudentVocabularyFromAttempt(studentId: string, taskEvaluation: {
  artifacts?: Record<string, unknown>;
}) {
  const used = Array.isArray(taskEvaluation.artifacts?.requiredWordsUsed)
    ? taskEvaluation.artifacts?.requiredWordsUsed.map((item) => String(item).toLowerCase())
    : [];
  const missing = Array.isArray(taskEvaluation.artifacts?.missingWords)
    ? taskEvaluation.artifacts?.missingWords.map((item) => String(item).toLowerCase())
    : [];

  const now = new Date();
  const reviewSoon = new Date(now);
  reviewSoon.setDate(reviewSoon.getDate() + 1);
  const reviewLater = new Date(now);
  reviewLater.setDate(reviewLater.getDate() + 7);

  for (const lemma of used) {
    await prisma.studentVocabulary.upsert({
      where: { studentId_lemma: { studentId, lemma } },
      update: {
        status: "active",
        retentionScore: { increment: 8 },
        usageEvidenceCount: { increment: 1 },
        nextReviewAt: reviewLater,
      },
      create: {
        studentId,
        lemma,
        status: "active",
        retentionScore: 55,
        usageEvidenceCount: 1,
        nextReviewAt: reviewLater,
      },
    });
  }

  for (const lemma of missing) {
    await prisma.studentVocabulary.upsert({
      where: { studentId_lemma: { studentId, lemma } },
      update: {
        status: "learning",
        nextReviewAt: reviewSoon,
      },
      create: {
        studentId,
        lemma,
        status: "learning",
        retentionScore: 20,
        usageEvidenceCount: 0,
        nextReviewAt: reviewSoon,
      },
    });
  }
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function computeRecoveryTrigger(studentId: string) {
  const attempts = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    orderBy: { completedAt: "desc" },
    take: 3,
  });
  if (attempts.length < 3) return false;

  const lowTaskChain = attempts.every((attempt) => {
    const scores = (attempt.scoresJson || {}) as { taskScore?: number };
    const taskScore = numeric(scores.taskScore);
    return taskScore !== null && taskScore < 55;
  });

  const confidences = attempts
    .map((attempt) => {
      const metrics = (attempt.speechMetricsJson || {}) as { confidence?: number };
      const confidence = numeric(metrics.confidence);
      return confidence !== null ? confidence * 100 : null;
    })
    .filter((value): value is number => value !== null);
  const confidenceDrop =
    confidences.length >= 3 && confidences[0] + 10 < (confidences[1] + confidences[2]) / 2;

  return lowTaskChain || confidenceDrop;
}

async function updatePlacementFromAttempt(params: {
  taskMeta: Record<string, unknown>;
  attemptId: string;
  transcript: string;
  scores: {
    speechScore: number | null;
    taskScore: number | null;
    languageScore: number | null;
    overallScore: number | null;
    reliability: string;
  };
  speechMetrics: ReturnType<typeof calculateDerivedSpeechMetrics>;
  taskEvaluation: {
    taskScore: number;
    artifacts?: Record<string, unknown>;
  };
  taskScore: number;
}) {
  if (params.taskMeta.placementMode === "placement_extended") return;

  const placementSessionId =
    typeof params.taskMeta.placementSessionId === "string"
      ? params.taskMeta.placementSessionId
      : null;
  const placementItemId =
    typeof params.taskMeta.placementItemId === "string"
      ? params.taskMeta.placementItemId
      : typeof params.taskMeta.placementQuestionId === "string"
      ? params.taskMeta.placementQuestionId
      : null;
  if (!placementSessionId || !placementItemId) return;

  const selfRating =
    params.taskScore >= 85 ? 5 : params.taskScore >= 70 ? 4 : params.taskScore >= 55 ? 3 : 2;
  const vocabularyUsage =
    typeof params.taskEvaluation.artifacts?.wordUsageCorrectness === "number"
      ? params.taskEvaluation.artifacts.wordUsageCorrectness
      : null;
  const session = await submitPlacementAnswer(placementSessionId, {
    itemId: placementItemId,
    attemptId: params.attemptId,
    transcript: params.transcript,
    selfRating,
    observedMetrics: {
      speechScore: params.scores.speechScore,
      taskScore: params.scores.taskScore,
      languageScore: params.scores.languageScore,
      overallScore: params.scores.overallScore,
      reliability: params.scores.reliability,
      speechRate: params.speechMetrics.speechRate ?? null,
      pronunciation:
        params.speechMetrics.pronunciationTargetRef ??
        params.speechMetrics.pronunciationSelfRef ??
        params.speechMetrics.pronunciation ??
        null,
      fluency: params.speechMetrics.fluency ?? null,
      vocabularyUsage,
      taskCompletion: params.taskEvaluation.taskScore,
    },
  });

  if (session.done) {
    await finishPlacement(placementSessionId);
  }
}

async function processAttempt(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { task: true },
  });

  if (!attempt || !attempt.audioObjectKey || attempt.status !== "processing") return;

  console.log(
    JSON.stringify({
      event: "attempt_processing_started",
      attemptId: attempt.id,
      taskType: attempt.task.type,
    })
  );

  try {
    const audioBuffer = await getObjectBuffer(attempt.audioObjectKey);
    const attemptCount = await prisma.attempt.count({
      where: { studentId: attempt.studentId, status: "completed" },
    });

    let analysis:
      | Awaited<ReturnType<typeof analyzeSpeechFromBuffer>>
      | undefined;
    let lastError: unknown = null;

    for (let i = 0; i < 2; i += 1) {
      try {
        analysis = await analyzeSpeechFromBuffer(audioBuffer, {
          taskPrompt: attempt.task.prompt,
          taskType: attempt.task.type,
          durationSec: attempt.durationSec,
          meta: (attempt.task.metaJson || {}) as {
            referenceText?: string;
            supportsPronAssessment?: boolean;
          },
        });
        break;
      } catch (error) {
        lastError = error;
        if (i === 0 && isTransientError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
      }
    }

    if (!analysis) throw lastError || new Error("Speech analysis failed");

    const taskMeta = (attempt.task.metaJson || {}) as Record<string, unknown>;
    const taskTargets = await prisma.taskGseTarget.findMany({
      where: { taskId: attempt.taskId },
      include: {
        node: {
          select: {
            nodeId: true,
            type: true,
            sourceKey: true,
            descriptor: true,
          },
        },
      },
    });
    const evaluated = await evaluateTaskQuality({
      taskId: attempt.taskId,
      taskType: attempt.task.type,
      taskPrompt: attempt.task.prompt,
      transcript: analysis.transcript,
      speechMetrics: calculateDerivedSpeechMetrics(analysis.metrics),
      taskMeta,
      taskTargets: taskTargets as unknown as EvaluationInput["taskTargets"],
    });
    const derivedMetrics = calculateDerivedSpeechMetrics(analysis.metrics);
    const languageScore = computeLanguageScoreFromTaskEvaluation(evaluated.taskEvaluation);
    const scores = composeScores({
      metrics: derivedMetrics,
      taskScore: evaluated.taskEvaluation.taskScore,
      languageScore,
      attemptCount: attemptCount + 1,
      strictReliabilityGating: config.worker.strictReliabilityGating,
    });
    const canonicalMetrics = buildCanonicalMetrics({
      derivedMetrics,
      taskEvaluation: evaluated.taskEvaluation,
      languageScore,
    });
    const aiDebug = {
      speech: {
        provider: analysis.provider,
        hasPronunciationAssessment:
          typeof analysis.metrics.accuracy === "number" ||
          typeof analysis.metrics.fluency === "number" ||
          typeof analysis.metrics.completeness === "number" ||
          typeof analysis.metrics.prosody === "number" ||
          typeof analysis.metrics.pronunciationTargetRef === "number" ||
          typeof analysis.metrics.pronunciationSelfRef === "number",
        metricsPresent: Object.keys(derivedMetrics),
        rawRecognition: analysis.raw,
      },
      evaluation: evaluated.debug,
    };

    await prisma.attempt.updateMany({
      where: { id: attempt.id, status: "processing" },
      data: {
        status: "completed",
        transcript: analysis.transcript,
        speechMetricsJson: derivedMetrics,
        rawRecognitionJson: analysis.raw as object,
        taskEvaluationJson: evaluated.taskEvaluation as object,
        aiDebugJson:
          config.worker.showAiDebug
            ? (aiDebug as Prisma.InputJsonValue)
            : Prisma.DbNull,
        scoresJson: scores,
        feedbackJson: evaluated.feedback as object,
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
      },
    });

    await prisma.attemptMetric.deleteMany({
      where: { attemptId: attempt.id },
    });
    if (canonicalMetrics.length > 0) {
      await prisma.attemptMetric.createMany({
        data: canonicalMetrics.map((metric) => ({
          attemptId: attempt.id,
          studentId: attempt.studentId,
          metricKey: metric.metricKey,
          value: metric.value,
          source: metric.source,
          reliability: metric.reliability,
          calculationVersion: SCORE_VERSION,
        })),
      });
    }

    await updateStudentVocabularyFromAttempt(attempt.studentId, evaluated.taskEvaluation);
    const learnerProfile = await prisma.learnerProfile.findUnique({
      where: { studentId: attempt.studentId },
      select: { ageBand: true },
    });
    const gseEvidence = await persistAttemptGseEvidence({
      attemptId: attempt.id,
      studentId: attempt.studentId,
      taskId: attempt.taskId,
      taskType: attempt.task.type,
      taskPrompt: attempt.task.prompt,
      taskMeta,
      transcript: analysis.transcript,
      derivedMetrics,
      taskEvaluation: evaluated.taskEvaluation,
      scoreReliability: scores.reliability,
      ageBand: learnerProfile?.ageBand || null,
    });
    if (gseEvidence.evidenceCount > 0) {
      console.log(JSON.stringify({ event: "gse_evidence_written", attemptId: attempt.id, count: gseEvidence.evidenceCount }));
    }
    const recoveryTriggered = await computeRecoveryTrigger(attempt.studentId);
    await prisma.attempt.updateMany({
      where: { id: attempt.id, status: "completed" },
      data: {
        nodeOutcomesJson: gseEvidence.nodeOutcomes as unknown as Prisma.InputJsonValue,
        recoveryTriggered,
      },
    });
    await updatePlacementFromAttempt({
      taskMeta,
      attemptId: attempt.id,
      transcript: analysis.transcript,
      scores,
      speechMetrics: derivedMetrics,
      taskEvaluation: evaluated.taskEvaluation,
      taskScore: evaluated.taskEvaluation.taskScore,
    });
    const isPlacementTask = Boolean(taskMeta.isPlacement);
    if (!isPlacementTask) {
      await prisma.learnerProfile.updateMany({
        where: { studentId: attempt.studentId, placementFresh: true },
        data: { placementFresh: false },
      });
      const profile = await prisma.learnerProfile.findUnique({
        where: { studentId: attempt.studentId },
        select: { coldStartAttempts: true, coldStartActive: true },
      });
      if (profile) {
        const nextAttempts = (profile.coldStartAttempts || 0) + 1;
          await prisma.learnerProfile.update({
          where: { studentId: attempt.studentId },
          data: {
            coldStartAttempts: nextAttempts,
            coldStartActive: profile.coldStartActive && nextAttempts < 8,
          },
        });
      }
    }
    await recomputeMastery(attempt.studentId);

    const dayKey = new Date();
    dayKey.setHours(0, 0, 0, 0);
    await prisma.progressDaily.upsert({
      where: {
        studentId_date: {
          studentId: attempt.studentId,
          date: dayKey,
        },
      },
      update: {
        metricsJson: {
          overallScore: scores.overallScore,
          speechScore: scores.speechScore,
          taskScore: scores.taskScore,
          languageScore: scores.languageScore,
          reliability: scores.reliability,
        },
      },
      create: {
        studentId: attempt.studentId,
        date: dayKey,
        metricsJson: {
          overallScore: scores.overallScore,
          speechScore: scores.speechScore,
          taskScore: scores.taskScore,
          languageScore: scores.languageScore,
          reliability: scores.reliability,
        },
      },
    });
  } catch (error) {
    const mapped = mapError(error);
    console.log(
      JSON.stringify({
        event: "attempt_failed_with_code",
        attemptId: attemptId,
        errorCode: mapped.code,
      })
    );

    await prisma.attempt.updateMany({
      where: { id: attemptId, status: { in: ["uploaded", "processing"] } },
      data: {
        status: "failed",
        errorCode: mapped.code,
        errorMessage: mapped.message,
        completedAt: new Date(),
      },
    });
  } finally {
    try {
      await deleteObject(attempt.audioObjectKey);
    } catch {
      // Ignore cleanup errors, they should not block user-visible result.
    }
  }
}

async function claimNextUploadedAttempt() {
  for (let i = 0; i < 4; i += 1) {
    const nextAttempt = await prisma.attempt.findFirst({
      where: { status: "uploaded" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!nextAttempt) return null;

    const claimed = await prisma.attempt.updateMany({
      where: { id: nextAttempt.id, status: "uploaded" },
      data: { status: "processing" },
    });
    if (claimed.count === 1) return nextAttempt.id;
  }
  return null;
}

async function loop() {
  for (;;) {
    const nextAttemptId = await claimNextUploadedAttempt();

    if (!nextAttemptId) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    await processAttempt(nextAttemptId);
  }
}

loop().catch((error) => {
  console.error("Worker crashed", error);
  process.exit(1);
});
