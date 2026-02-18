import { prisma } from "@/lib/db";
import {
  languageSignalTelemetryReportSchema,
  type LanguageSignalTelemetryReport,
} from "@/lib/contracts/languageSignalTelemetry";
import {
  PERCEPTION_LANGUAGE_SIGNALS_VERSION,
  type PerceptionLanguageTag,
} from "@/lib/perception/languageSignals";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_CONFIDENCE_THRESHOLD = 0.65;

type AttemptRow = {
  id: string;
  studentId: string;
  createdAt: Date;
  transcript: string | null;
  taskEvaluationJson: unknown;
};

type ParsedSignalSnapshot = {
  primaryTag: PerceptionLanguageTag | "unknown";
  primaryConfidence: number;
  codeSwitchDetected: boolean;
  tagSet: Array<PerceptionLanguageTag | "unknown">;
  homeLanguageHints: string[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function parseLanguageSnapshot(taskEvaluationJson: unknown): ParsedSignalSnapshot | null {
  const taskEvaluation = asObject(taskEvaluationJson);
  const artifacts = asObject(taskEvaluation.artifacts);
  const languageSignals = asObject(artifacts.languageSignals);
  if (Object.keys(languageSignals).length === 0) return null;

  const primaryTagRaw = asString(languageSignals.primaryTag) || "unknown";
  const primaryTag: ParsedSignalSnapshot["primaryTag"] =
    primaryTagRaw === "english" ||
    primaryTagRaw === "swahili" ||
    primaryTagRaw === "sheng" ||
    primaryTagRaw === "home_language_hint" ||
    primaryTagRaw === "unknown"
      ? primaryTagRaw
      : "unknown";
  const primaryConfidence = Math.max(0, Math.min(1, asNumber(languageSignals.primaryConfidence) ?? 0));

  const codeSwitch = asObject(languageSignals.codeSwitch);
  const codeSwitchDetected = asBoolean(codeSwitch.detected) || false;

  const tagSet = Array.isArray(languageSignals.tags)
    ? Array.from(
        new Set(
          languageSignals.tags
            .map((item) => asString(asObject(item).tag))
            .filter(
              (tag): tag is PerceptionLanguageTag | "unknown" =>
                tag === "english" ||
                tag === "swahili" ||
                tag === "sheng" ||
                tag === "home_language_hint" ||
                tag === "unknown"
            )
        )
      )
    : [];

  if (tagSet.length === 0) tagSet.push(primaryTag);

  const homeLanguageHints = Array.isArray(languageSignals.homeLanguageHints)
    ? Array.from(
        new Set(
          languageSignals.homeLanguageHints
            .map((item) => asString(asObject(item).language))
            .filter((value): value is string => Boolean(value))
        )
      )
    : [];

  return {
    primaryTag,
    primaryConfidence: Number(primaryConfidence.toFixed(4)),
    codeSwitchDetected,
    tagSet,
    homeLanguageHints,
  };
}

function sortCountRows(map: Map<string, number>) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
}

function average(values: number[]) {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(6));
}

export function summarizeLanguageSignalTelemetry(params: {
  attemptRows: AttemptRow[];
  windowDays: number;
  sampleLimit?: number;
  now?: Date;
}): LanguageSignalTelemetryReport {
  const now = params.now || new Date();
  const sampleLimit = Math.max(1, Math.min(100, Math.floor(params.sampleLimit ?? 20)));

  let taggedAttempts = 0;
  let codeSwitchDetectedCount = 0;
  let lowConfidenceCount = 0;
  const primaryConfidences: number[] = [];
  const primaryTagCounts = new Map<string, number>();
  const tagPresenceCounts = new Map<string, number>();
  const homeLanguageHintCounts = new Map<string, number>();
  const calibrationCandidates: Array<{ score: number; sample: LanguageSignalTelemetryReport["calibrationSamples"][number] }> = [];

  for (const row of params.attemptRows) {
    const parsed = parseLanguageSnapshot(row.taskEvaluationJson);
    if (!parsed) continue;

    taggedAttempts += 1;
    primaryConfidences.push(parsed.primaryConfidence);
    primaryTagCounts.set(parsed.primaryTag, (primaryTagCounts.get(parsed.primaryTag) || 0) + 1);

    for (const tag of parsed.tagSet) {
      tagPresenceCounts.set(tag, (tagPresenceCounts.get(tag) || 0) + 1);
    }
    for (const language of parsed.homeLanguageHints) {
      homeLanguageHintCounts.set(language, (homeLanguageHintCounts.get(language) || 0) + 1);
    }

    if (parsed.codeSwitchDetected) codeSwitchDetectedCount += 1;
    if (parsed.primaryConfidence < LOW_CONFIDENCE_THRESHOLD) lowConfidenceCount += 1;

    const shouldSample =
      parsed.codeSwitchDetected ||
      parsed.primaryConfidence < LOW_CONFIDENCE_THRESHOLD ||
      parsed.homeLanguageHints.length > 0;
    if (!shouldSample) continue;

    const transcriptPreview = (row.transcript || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const sample = {
      attemptId: row.id,
      studentId: row.studentId,
      createdAt: row.createdAt.toISOString(),
      primaryTag: parsed.primaryTag,
      primaryConfidence: parsed.primaryConfidence,
      codeSwitchDetected: parsed.codeSwitchDetected,
      tagSet: parsed.tagSet,
      transcriptPreview,
    };
    const score =
      (parsed.codeSwitchDetected ? 3 : 0) +
      (parsed.homeLanguageHints.length > 0 ? 2 : 0) +
      (parsed.primaryConfidence < LOW_CONFIDENCE_THRESHOLD ? 2 : 0) +
      (1 - parsed.primaryConfidence);
    calibrationCandidates.push({ score, sample });
  }

  const totalAttempts = params.attemptRows.length;
  const calibrationSamples = calibrationCandidates
    .sort((a, b) => b.score - a.score || b.sample.createdAt.localeCompare(a.sample.createdAt))
    .slice(0, sampleLimit)
    .map((item) => item.sample);

  return languageSignalTelemetryReportSchema.parse({
    generatedAt: now.toISOString(),
    version: PERCEPTION_LANGUAGE_SIGNALS_VERSION,
    windowDays: params.windowDays,
    totalAttempts,
    taggedAttempts,
    tagCoverageRate: totalAttempts > 0 ? Number((taggedAttempts / totalAttempts).toFixed(6)) : 0,
    codeSwitchDetectedCount,
    codeSwitchDetectedRate:
      taggedAttempts > 0 ? Number((codeSwitchDetectedCount / taggedAttempts).toFixed(6)) : 0,
    lowConfidenceCount,
    averagePrimaryConfidence: average(primaryConfidences),
    primaryTagCounts: sortCountRows(primaryTagCounts),
    tagPresenceCounts: sortCountRows(tagPresenceCounts),
    homeLanguageHintCounts: sortCountRows(homeLanguageHintCounts),
    calibrationSamples,
  });
}

export async function buildLanguageSignalTelemetryReport(params?: {
  windowDays?: number;
  attemptLimit?: number;
  sampleLimit?: number;
  now?: Date;
}): Promise<LanguageSignalTelemetryReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const attemptLimit = Math.max(10, Math.min(50000, Math.floor(params?.attemptLimit ?? 5000)));
  const sampleLimit = Math.max(1, Math.min(100, Math.floor(params?.sampleLimit ?? 20)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const attemptRows = await prisma.attempt.findMany({
    where: {
      status: "completed",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: attemptLimit,
    select: {
      id: true,
      studentId: true,
      createdAt: true,
      transcript: true,
      taskEvaluationJson: true,
    },
  });

  return summarizeLanguageSignalTelemetry({
    attemptRows,
    windowDays,
    sampleLimit,
    now,
  });
}
