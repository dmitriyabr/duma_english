import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { SpeechMetrics } from "@/lib/scoring";

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
    include: { task: true },
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
    evidence?: string[];
    modelVersion?: string;
  } | null;

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
    provider: process.env.SPEECH_PROVIDER || "mock",
  };

  return NextResponse.json({
    status: attempt.status,
    flow: {
      isPlacement: Boolean((attempt.task.metaJson as { isPlacement?: boolean } | null)?.isPlacement),
      placementSessionId:
        ((attempt.task.metaJson as { placementSessionId?: string } | null)?.placementSessionId) || null,
    },
    error:
      attempt.status === "failed"
        ? {
            code: attempt.errorCode,
            message: attempt.errorMessage,
          }
        : null,
    results:
      attempt.status === "completed"
        ? {
            transcript: attempt.transcript,
            speech,
            scores,
            taskEvaluation,
            feedback,
            visibleMetrics,
            debug: process.env.SHOW_AI_DEBUG === "true" ? attempt.aiDebugJson : null,
          }
        : null,
  });
}
