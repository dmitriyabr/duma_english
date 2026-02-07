import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { getObjectBuffer, deleteObject } from "../lib/storage";
import { analyzeSpeechFromBuffer } from "../lib/speech";
import { calculateDerivedSpeechMetrics, composeScores } from "../lib/scoring";
import { computeLanguageScoreFromTaskEvaluation, evaluateTaskQuality } from "../lib/evaluator";
import { recomputeMastery } from "../lib/adaptive";
import { finishPlacement, getPlacementQuestions, submitPlacementAnswer } from "../lib/placement";
import { persistAttemptGseEvidence } from "../lib/gse/evidence";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 3000);
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

function reliabilityRank(value: MetricReliability) {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function selectBestReliability(values: MetricReliability[]) {
  if (!values.length) return "low" as MetricReliability;
  return values.sort((a, b) => reliabilityRank(b) - reliabilityRank(a))[0];
}

async function aggregateDailySkills(studentId: string, metrics: CanonicalMetric[], createdAt: Date) {
  const bySkill: Record<string, CanonicalMetric[]> = {
    pronunciation: metrics.filter((m) => m.metricKey === "pronunciation_target_ref" || m.metricKey === "pronunciation_self_ref"),
    fluency: metrics.filter((m) => m.metricKey === "fluency"),
    tempo_control: metrics.filter((m) => m.metricKey === "tempo_stability" || m.metricKey === "tempo_wpm"),
    vocabulary: metrics.filter((m) => m.metricKey === "vocabulary_usage" || m.metricKey === "language_score"),
    grammar: metrics.filter((m) => m.metricKey === "grammar_accuracy"),
    task_completion: metrics.filter((m) => m.metricKey === "task_completion"),
  };

  const day = new Date(createdAt);
  day.setHours(0, 0, 0, 0);

  for (const [skillKey, records] of Object.entries(bySkill)) {
    if (records.length === 0) continue;
    const value = roundMetric(records.reduce((sum, item) => sum + item.value, 0) / records.length);
    const reliability = selectBestReliability(records.map((record) => record.reliability));
    const existing = await prisma.studentSkillDaily.findUnique({
      where: { studentId_date_skillKey: { studentId, date: day, skillKey } },
    });

    if (!existing) {
      await prisma.studentSkillDaily.create({
        data: {
          studentId,
          date: day,
          skillKey,
          value,
          sampleCount: 1,
          reliability,
        },
      });
      continue;
    }

    const nextCount = existing.sampleCount + 1;
    const nextValue = roundMetric((existing.value * existing.sampleCount + value) / nextCount);
    await prisma.studentSkillDaily.update({
      where: { id: existing.id },
      data: {
        value: nextValue,
        sampleCount: nextCount,
        reliability: selectBestReliability([existing.reliability as MetricReliability, reliability]),
      },
    });
  }

  console.log(JSON.stringify({ event: "progress_aggregated", studentId }));
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
  const placementSessionId =
    typeof params.taskMeta.placementSessionId === "string"
      ? params.taskMeta.placementSessionId
      : null;
  const placementQuestionId =
    typeof params.taskMeta.placementQuestionId === "string"
      ? params.taskMeta.placementQuestionId
      : null;
  if (!placementSessionId || !placementQuestionId) return;

  const selfRating =
    params.taskScore >= 85 ? 5 : params.taskScore >= 70 ? 4 : params.taskScore >= 55 ? 3 : 2;
  const vocabularyUsage =
    typeof params.taskEvaluation.artifacts?.wordUsageCorrectness === "number"
      ? params.taskEvaluation.artifacts.wordUsageCorrectness
      : null;
  const session = await submitPlacementAnswer(placementSessionId, {
    questionId: placementQuestionId,
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

  const total = getPlacementQuestions().length;
  if (session.currentIndex >= total) {
    await finishPlacement(placementSessionId);
  }
}

async function processAttempt(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { task: true },
  });

  if (!attempt || !attempt.audioObjectKey) return;

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
    const evaluated = await evaluateTaskQuality({
      taskType: attempt.task.type,
      taskPrompt: attempt.task.prompt,
      transcript: analysis.transcript,
      speechMetrics: calculateDerivedSpeechMetrics(analysis.metrics),
      taskMeta,
    });
    const derivedMetrics = calculateDerivedSpeechMetrics(analysis.metrics);
    const languageScore = computeLanguageScoreFromTaskEvaluation(evaluated.taskEvaluation);
    const scores = composeScores({
      metrics: derivedMetrics,
      taskScore: evaluated.taskEvaluation.taskScore,
      languageScore,
      attemptCount: attemptCount + 1,
      strictReliabilityGating: process.env.STRICT_RELIABILITY_GATING === "true",
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

    await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        status: "completed",
        transcript: analysis.transcript,
        speechMetricsJson: derivedMetrics,
        rawRecognitionJson: analysis.raw as object,
        taskEvaluationJson: evaluated.taskEvaluation as object,
        aiDebugJson:
          process.env.SHOW_AI_DEBUG === "true"
            ? (aiDebug as Prisma.InputJsonValue)
            : Prisma.DbNull,
        scoresJson: scores,
        feedbackJson: evaluated.feedback as object,
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
      },
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
    const gseEvidence = await persistAttemptGseEvidence({
      attemptId: attempt.id,
      studentId: attempt.studentId,
      taskId: attempt.taskId,
      transcript: analysis.transcript,
      derivedMetrics,
      taskEvaluation: evaluated.taskEvaluation,
      scoreReliability: scores.reliability,
    });
    if (gseEvidence.evidenceCount > 0) {
      console.log(JSON.stringify({ event: "gse_evidence_written", attemptId: attempt.id, count: gseEvidence.evidenceCount }));
    }
    await updatePlacementFromAttempt({
      taskMeta,
      attemptId: attempt.id,
      transcript: analysis.transcript,
      scores,
      speechMetrics: derivedMetrics,
      taskEvaluation: evaluated.taskEvaluation,
      taskScore: evaluated.taskEvaluation.taskScore,
    });
    await aggregateDailySkills(attempt.studentId, canonicalMetrics, attempt.createdAt);
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

    await prisma.attempt.update({
      where: { id: attemptId },
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

async function loop() {
  for (;;) {
    const nextAttempt = await prisma.attempt.findFirst({
      where: { status: "uploaded" },
      orderBy: { createdAt: "asc" },
    });

    if (!nextAttempt) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    await prisma.attempt.update({
      where: { id: nextAttempt.id },
      data: { status: "processing" },
    });
    await processAttempt(nextAttempt.id);
  }
}

loop().catch((error) => {
  console.error("Worker crashed", error);
  process.exit(1);
});
