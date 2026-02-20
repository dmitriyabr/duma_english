const TASK_PASS_THRESHOLD = 65;
const DOMAIN_PASS_THRESHOLD = 60;

export const REQUIRED_MODALITY_DOMAINS = [
  "speaking",
  "listening",
  "reading",
  "writing",
  "grammar",
  "vocabulary",
] as const;

export type PlacementDomain = (typeof REQUIRED_MODALITY_DOMAINS)[number];

/** Canonical task type per placement domain for cold-start cross-modality coverage. */
export const PLACEMENT_DOMAIN_TO_TASK_TYPE: Record<PlacementDomain, string> = {
  speaking: "topic_talk",
  listening: "listening_comprehension",
  reading: "reading_comprehension",
  writing: "writing_prompt",
  grammar: "qa_prompt",
  vocabulary: "target_vocab",
};

export type CrossModalityAttemptRow = {
  taskType: string | null;
  taskMetaJson: unknown;
  taskEvaluationJson: unknown;
  scoresJson: unknown;
};

export type PlacementDomainConfidenceRow = {
  domain: PlacementDomain;
  sampleCount: number;
  avgScore: number | null;
  passRate: number | null;
  confidence: number;
  uncertainty: number;
};

export type CrossModalityPlacementSummary = {
  requiredDomains: PlacementDomain[];
  missingDomains: PlacementDomain[];
  coverageRate: number;
  overallConfidence: number;
  maxUncertainty: number;
  stopCriteriaSatisfied: boolean;
  byDomain: PlacementDomainConfidenceRow[];
};

type DomainAccumulator = {
  scores: number[];
  passes: number;
};

const SPEAKING_TASK_TYPES = new Set([
  "read_aloud",
  "target_vocab",
  "qa_prompt",
  "filler_control",
  "role_play",
  "topic_talk",
  "speech_builder",
  "argumentation",
  "register_switch",
  "misunderstanding_repair",
]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function ratioOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function detectTaskDomain(taskType: string, taskMeta: Record<string, unknown>): PlacementDomain | null {
  if (taskType === "reading_comprehension") return "reading";
  if (taskType === "listening_comprehension") return "listening";
  if (taskType === "writing_prompt") return "writing";
  if (SPEAKING_TASK_TYPES.has(taskType)) return "speaking";

  const assessmentMode =
    taskMeta.assessmentMode === "text"
      ? "text"
      : taskMeta.assessmentMode === "pa"
      ? "pa"
      : taskMeta.assessmentMode === "stt"
      ? "stt"
      : null;
  if (assessmentMode === "text") return "writing";
  if (assessmentMode === "pa" || assessmentMode === "stt") return "speaking";

  return null;
}

function pushDomainScore(
  accumulator: Map<PlacementDomain, DomainAccumulator>,
  domain: PlacementDomain,
  score: number,
  threshold: number,
) {
  const bucket = accumulator.get(domain) || { scores: [], passes: 0 };
  bucket.scores.push(score);
  if (score >= threshold) bucket.passes += 1;
  accumulator.set(domain, bucket);
}

function computeDomainConfidenceRow(domain: PlacementDomain, bucket?: DomainAccumulator): PlacementDomainConfidenceRow {
  const sampleCount = bucket?.scores.length || 0;
  const avgScore = average(bucket?.scores || []);
  const passRate = ratioOrNull(bucket?.passes || 0, sampleCount);

  const baseUncertainty = sampleCount <= 0 ? 1 : clamp(1 / Math.sqrt(sampleCount + 1), 0, 1);
  const spreadPenalty =
    sampleCount <= 1
      ? 0.35
      : clamp(stdDev(bucket?.scores || []) / 50, 0, 1);
  const qualityPenalty =
    passRate === null
      ? 0.45
      : clamp(1 - passRate, 0, 1);

  const uncertainty = Number(
    clamp(baseUncertainty * 0.55 + spreadPenalty * 0.25 + qualityPenalty * 0.2, 0, 1).toFixed(6),
  );
  const confidence = Number((1 - uncertainty).toFixed(6));

  return {
    domain,
    sampleCount,
    avgScore,
    passRate,
    confidence,
    uncertainty,
  };
}

function extractDomainScores(row: CrossModalityAttemptRow): Array<{ domain: PlacementDomain; score: number; threshold: number }> {
  const taskMeta = asObject(row.taskMetaJson);
  const taskEvaluation = asObject(row.taskEvaluationJson);
  const taskArtifacts = asObject(taskEvaluation.artifacts);
  const scores = asObject(row.scoresJson);
  const taskType = row.taskType || "";

  const extracted: Array<{ domain: PlacementDomain; score: number; threshold: number }> = [];

  const taskScore = asNumber(scores.taskScore) ?? asNumber(taskEvaluation.taskScore);
  const taskDomain = detectTaskDomain(taskType, taskMeta);
  if (taskDomain && typeof taskScore === "number") {
    extracted.push({ domain: taskDomain, score: clamp(taskScore, 0, 100), threshold: TASK_PASS_THRESHOLD });
  }

  const grammarFromChecks = (() => {
    const checks = Array.isArray(taskEvaluation.grammarChecks)
      ? taskEvaluation.grammarChecks.filter((value) => value && typeof value === "object")
      : [];
    if (!checks.length) return null;
    const passes = checks.reduce((sum, value) => {
      const pass = asObject(value).pass;
      return sum + (pass === true ? 1 : 0);
    }, 0);
    return (passes / checks.length) * 100;
  })();
  const grammarScore =
    grammarFromChecks ??
    asNumber(taskArtifacts.grammarAccuracy) ??
    asNumber(taskArtifacts.grammarStabilityScore);
  if (typeof grammarScore === "number") {
    extracted.push({ domain: "grammar", score: clamp(grammarScore, 0, 100), threshold: DOMAIN_PASS_THRESHOLD });
  }

  const vocabularyFromChecks = (() => {
    const checks = Array.isArray(taskEvaluation.vocabChecks)
      ? taskEvaluation.vocabChecks.filter((value) => value && typeof value === "object")
      : [];
    if (!checks.length) return null;
    const passes = checks.reduce((sum, value) => {
      const pass = asObject(value).pass;
      return sum + (pass === true ? 1 : 0);
    }, 0);
    return (passes / checks.length) * 100;
  })();
  const vocabularyScore =
    vocabularyFromChecks ??
    asNumber(taskArtifacts.vocabularyUsage) ??
    asNumber(taskArtifacts.vocabCoverageScore);
  if (typeof vocabularyScore === "number") {
    extracted.push({ domain: "vocabulary", score: clamp(vocabularyScore, 0, 100), threshold: DOMAIN_PASS_THRESHOLD });
  }

  return extracted;
}

export function summarizeCrossModalityPlacement(params: {
  rows: CrossModalityAttemptRow[];
  maxUncertaintyThreshold?: number;
}): CrossModalityPlacementSummary {
  const maxUncertaintyThreshold = clamp(params.maxUncertaintyThreshold ?? 0.35, 0.05, 0.95);
  const domainScores = new Map<PlacementDomain, DomainAccumulator>();

  for (const row of params.rows) {
    const extracted = extractDomainScores(row);
    for (const sample of extracted) {
      pushDomainScore(domainScores, sample.domain, sample.score, sample.threshold);
    }
  }

  const byDomain = REQUIRED_MODALITY_DOMAINS.map((domain) =>
    computeDomainConfidenceRow(domain, domainScores.get(domain)),
  );
  const missingDomains = byDomain.filter((row) => row.sampleCount <= 0).map((row) => row.domain);
  const coveredDomains = byDomain.filter((row) => row.sampleCount > 0).length;
  const coverageRate = Number((coveredDomains / REQUIRED_MODALITY_DOMAINS.length).toFixed(6));
  const maxUncertainty = Number(
    Math.max(...byDomain.map((row) => row.uncertainty), 1).toFixed(6),
  );

  const overallConfidence = Number(
    (
      byDomain.reduce((sum, row) => sum + row.confidence, 0) /
      REQUIRED_MODALITY_DOMAINS.length
    ).toFixed(6),
  );

  return {
    requiredDomains: [...REQUIRED_MODALITY_DOMAINS],
    missingDomains,
    coverageRate,
    overallConfidence,
    maxUncertainty,
    stopCriteriaSatisfied:
      missingDomains.length === 0 && maxUncertainty <= maxUncertaintyThreshold,
    byDomain,
  };
}
