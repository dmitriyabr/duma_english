export type MetricReliability = "high" | "medium" | "low";

export type SpeechMetrics = {
  accuracy?: number;
  pronunciation?: number;
  pronunciationTargetRef?: number;
  pronunciationSelfRef?: number;
  fluency?: number;
  completeness?: number;
  confidence?: number;
  prosody?: number;
  speechRate?: number;
  pauseCount?: number;
  fillerCount?: number;
  durationSec?: number;
  wordCount?: number;
  tempoStability?: number;
  pauseDensityPerMin?: number;
  fillerDensityPer100?: number;
};

export type ScoreBreakdown = {
  speechScore: number | null;
  taskScore: number | null;
  languageScore: number | null;
  overallScore: number | null;
  reliability: MetricReliability;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stageWeights(attemptCount: number) {
  if (attemptCount <= 10) return { speech: 0.6, task: 0.25, language: 0.15 };
  if (attemptCount <= 30) return { speech: 0.45, task: 0.35, language: 0.2 };
  return { speech: 0.35, task: 0.4, language: 0.25 };
}

export function calculateDerivedSpeechMetrics(metrics: SpeechMetrics): SpeechMetrics {
  const next = { ...metrics };
  const speechRate = safeNumber(metrics.speechRate);
  const pauseCount = safeNumber(metrics.pauseCount);
  const fillerCount = safeNumber(metrics.fillerCount);
  const wordCount = safeNumber(metrics.wordCount);
  const durationSec = safeNumber(metrics.durationSec);

  if (speechRate !== null) {
    const stability =
      speechRate >= 105 && speechRate <= 145 ? 90 : speechRate >= 90 && speechRate <= 160 ? 76 : 58;
    next.tempoStability = Math.round(stability);
  }
  if (pauseCount !== null && durationSec !== null && durationSec > 0) {
    next.pauseDensityPerMin = Number(((pauseCount / durationSec) * 60).toFixed(2));
  }
  if (fillerCount !== null && wordCount !== null && wordCount > 0) {
    next.fillerDensityPer100 = Number(((fillerCount / wordCount) * 100).toFixed(2));
  }
  return next;
}

export function computeSpeechScore(metricsInput: SpeechMetrics): {
  score: number | null;
  reliability: MetricReliability;
} {
  const metrics = calculateDerivedSpeechMetrics(metricsInput);

  const paSignals = [
    safeNumber(metrics.pronunciationTargetRef),
    safeNumber(metrics.accuracy),
    safeNumber(metrics.fluency),
    safeNumber(metrics.completeness),
    safeNumber(metrics.prosody),
  ].filter((v): v is number => v !== null);

  if (paSignals.length >= 3) {
    const avg = paSignals.reduce((sum, value) => sum + value, 0) / paSignals.length;
    return { score: Math.round(clamp(avg)), reliability: "high" };
  }

  const derivedSignals: number[] = [];
  const speechRate = safeNumber(metrics.speechRate);
  const fillerDensity = safeNumber(metrics.fillerDensityPer100);
  const pauseDensity = safeNumber(metrics.pauseDensityPerMin);
  const confidence = safeNumber(metrics.confidence);
  const selfRef = safeNumber(metrics.pronunciationSelfRef);

  if (speechRate !== null) {
    const paceScore =
      speechRate >= 105 && speechRate <= 145 ? 88 : speechRate >= 90 && speechRate <= 160 ? 74 : 58;
    derivedSignals.push(paceScore);
  }
  if (fillerDensity !== null) {
    derivedSignals.push(clamp(95 - fillerDensity * 6));
  }
  if (pauseDensity !== null) {
    const pauseScore = pauseDensity <= 12 ? 88 : pauseDensity <= 18 ? 74 : 58;
    derivedSignals.push(pauseScore);
  }
  if (confidence !== null) {
    derivedSignals.push(clamp(confidence * 100));
  }
  if (selfRef !== null) {
    derivedSignals.push(selfRef);
  }

  if (derivedSignals.length >= 3) {
    const avg = derivedSignals.reduce((sum, value) => sum + value, 0) / derivedSignals.length;
    return {
      score: Math.round(clamp(avg)),
      reliability: selfRef !== null ? "medium" : "medium",
    };
  }

  if (derivedSignals.length > 0) {
    const avg = derivedSignals.reduce((sum, value) => sum + value, 0) / derivedSignals.length;
    return { score: Math.round(clamp(avg)), reliability: "low" };
  }

  return { score: null, reliability: "low" };
}

function scoreReliability(values: Array<number | null>, strict: boolean) {
  if (values.some((value) => value === null)) return "low" as const;
  return strict ? ("high" as const) : ("medium" as const);
}

export function composeScores(options: {
  metrics: SpeechMetrics;
  taskScore: number | null | undefined;
  languageScore: number | null | undefined;
  attemptCount: number;
  strictReliabilityGating?: boolean;
}): ScoreBreakdown {
  const strict = Boolean(options.strictReliabilityGating);
  const speech = computeSpeechScore(options.metrics);
  const taskScore =
    typeof options.taskScore === "number" && Number.isFinite(options.taskScore)
      ? Math.round(clamp(options.taskScore))
      : null;
  const languageScore =
    typeof options.languageScore === "number" && Number.isFinite(options.languageScore)
      ? Math.round(clamp(options.languageScore))
      : null;

  let overallScore: number | null = null;
  const reliability = scoreReliability([speech.score, taskScore, languageScore], strict);

  if (speech.score !== null && taskScore !== null && languageScore !== null) {
    const weights = stageWeights(options.attemptCount);
    overallScore = Math.round(
      clamp(
        speech.score * weights.speech +
          taskScore * weights.task +
          languageScore * weights.language
      )
    );
  }

  if (strict && reliability === "low") {
    overallScore = null;
  }

  return {
    speechScore: speech.score,
    taskScore,
    languageScore,
    overallScore,
    reliability: reliability === "low" ? speech.reliability : reliability,
  };
}
