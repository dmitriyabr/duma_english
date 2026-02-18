import { prisma } from "@/lib/db";
import {
  localePolicyContextReportSchema,
  type LocalePolicyContextReport,
} from "@/lib/contracts/localePolicyContextReport";
import { LOCALE_POLICY_CONTEXT_VERSION } from "@/lib/localization/localePolicyContext";

const DAY_MS = 24 * 60 * 60 * 1000;

type DecisionRow = {
  id: string;
  studentId: string;
  decisionTs: Date;
  chosenTaskType: string;
  utilityJson: unknown;
  taskInstance: {
    taskId: string;
  } | null;
};

type AttemptScoreRow = {
  taskId: string;
  scoresJson: unknown;
};

type ParsedLocaleDecision = {
  applied: boolean;
  overrideApplied: boolean;
  reasonCodes: string[];
  primaryTag: "english" | "swahili" | "sheng" | "home_language_hint" | "unknown";
  codeSwitchRate: number;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toReasonCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function parseLocaleDecision(row: DecisionRow): ParsedLocaleDecision {
  const utility = asObject(row.utilityJson);
  const localeProfile = asObject(utility.localeProfile);
  const localeAdaptation = asObject(utility.localeAdaptation);

  const primaryTagRaw = asString(localeProfile.dominantPrimaryTag) || "unknown";
  const primaryTag =
    primaryTagRaw === "english" ||
    primaryTagRaw === "swahili" ||
    primaryTagRaw === "sheng" ||
    primaryTagRaw === "home_language_hint" ||
    primaryTagRaw === "unknown"
      ? primaryTagRaw
      : "unknown";
  const codeSwitchRate = Math.max(0, Math.min(1, asNumber(localeProfile.codeSwitchRate) ?? 0));
  const reasonCodes = toReasonCodes(localeAdaptation.reasonCodes);

  return {
    applied: asBoolean(localeAdaptation.applied) || false,
    overrideApplied: asBoolean(localeAdaptation.overrideApplied) || false,
    reasonCodes,
    primaryTag,
    codeSwitchRate: Number(codeSwitchRate.toFixed(6)),
  };
}

function sortCountRows(map: Map<string, number>) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
}

export function summarizeLocalePolicyContextReport(params: {
  decisionRows: DecisionRow[];
  attemptScoreRows: AttemptScoreRow[];
  windowDays: number;
  sampleLimit?: number;
  now?: Date;
}): LocalePolicyContextReport {
  const now = params.now || new Date();
  const sampleLimit = Math.max(1, Math.min(100, Math.floor(params.sampleLimit ?? 20)));
  const scoreByTaskId = new Map<string, number>();
  for (const row of params.attemptScoreRows) {
    const scores = asObject(row.scoresJson);
    const taskScore = asNumber(scores.taskScore);
    if (taskScore === null || scoreByTaskId.has(row.taskId)) continue;
    scoreByTaskId.set(row.taskId, taskScore);
  }

  const reasonCodeCounts = new Map<string, number>();
  const dominantPrimaryTagCounts = new Map<string, number>();
  const localizedSamples: LocalePolicyContextReport["localizedDecisionSamples"] = [];
  const localizedScores: number[] = [];
  const baselineScores: number[] = [];
  let localizedDecisionCount = 0;

  for (const row of params.decisionRows) {
    const parsed = parseLocaleDecision(row);
    const taskScore = row.taskInstance ? scoreByTaskId.get(row.taskInstance.taskId) : undefined;

    if (parsed.applied) {
      localizedDecisionCount += 1;
      dominantPrimaryTagCounts.set(parsed.primaryTag, (dominantPrimaryTagCounts.get(parsed.primaryTag) || 0) + 1);
      for (const reasonCode of parsed.reasonCodes) {
        reasonCodeCounts.set(reasonCode, (reasonCodeCounts.get(reasonCode) || 0) + 1);
      }
      if (typeof taskScore === "number") {
        localizedScores.push(taskScore);
      }
      if (localizedSamples.length < sampleLimit) {
        localizedSamples.push({
          decisionId: row.id,
          studentId: row.studentId,
          decisionTs: row.decisionTs.toISOString(),
          chosenTaskType: row.chosenTaskType,
          primaryTag: parsed.primaryTag,
          codeSwitchRate: parsed.codeSwitchRate,
          overrideApplied: parsed.overrideApplied,
          reasonCodes: parsed.reasonCodes,
        });
      }
    } else if (typeof taskScore === "number") {
      baselineScores.push(taskScore);
    }
  }

  const totalDecisions = params.decisionRows.length;
  const localizedAvgTaskScore = average(localizedScores);
  const baselineAvgTaskScore = average(baselineScores);
  const uplift =
    localizedAvgTaskScore !== null && baselineAvgTaskScore !== null
      ? Number((localizedAvgTaskScore - baselineAvgTaskScore).toFixed(6))
      : null;

  return localePolicyContextReportSchema.parse({
    generatedAt: now.toISOString(),
    version: LOCALE_POLICY_CONTEXT_VERSION,
    windowDays: params.windowDays,
    totalDecisions,
    localizedDecisionCount,
    localizedDecisionShare:
      totalDecisions > 0 ? Number((localizedDecisionCount / totalDecisions).toFixed(6)) : 0,
    localizedAvgTaskScore,
    baselineAvgTaskScore,
    localizedVsBaselineTaskScoreUplift: uplift,
    dominantPrimaryTagCounts: sortCountRows(dominantPrimaryTagCounts),
    reasonCodeCounts: sortCountRows(reasonCodeCounts),
    localizedDecisionSamples: localizedSamples,
  });
}

export async function buildLocalePolicyContextReport(params?: {
  windowDays?: number;
  decisionLimit?: number;
  sampleLimit?: number;
  now?: Date;
}): Promise<LocalePolicyContextReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const decisionLimit = Math.max(10, Math.min(50000, Math.floor(params?.decisionLimit ?? 5000)));
  const sampleLimit = Math.max(1, Math.min(100, Math.floor(params?.sampleLimit ?? 20)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const decisionRows = await prisma.plannerDecisionLog.findMany({
    where: {
      decisionTs: { gte: since },
    },
    orderBy: { decisionTs: "desc" },
    take: decisionLimit,
    select: {
      id: true,
      studentId: true,
      decisionTs: true,
      chosenTaskType: true,
      utilityJson: true,
      taskInstance: {
        select: { taskId: true },
      },
    },
  });
  const taskIds = Array.from(
    new Set(decisionRows.map((row) => row.taskInstance?.taskId).filter((taskId): taskId is string => Boolean(taskId)))
  );
  const attemptScoreRows =
    taskIds.length > 0
      ? await prisma.attempt.findMany({
          where: {
            status: "completed",
            taskId: { in: taskIds },
          },
          orderBy: { createdAt: "asc" },
          select: {
            taskId: true,
            scoresJson: true,
          },
        })
      : [];

  return summarizeLocalePolicyContextReport({
    decisionRows,
    attemptScoreRows,
    windowDays,
    sampleLimit,
    now,
  });
}
