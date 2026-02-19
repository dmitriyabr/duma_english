import { prisma } from "@/lib/db";
import { isDiscoursePragmaticsTaskType } from "@/lib/discourse/pragmatics";
import { TASK_TEMPLATES } from "@/lib/taskTemplates";
import {
  ADVANCED_DISCOURSE_TASK_FAMILIES,
  ADVANCED_DISCOURSE_TASK_FAMILIES_REPORT_VERSION,
  BASELINE_TASK_FAMILIES_PRE_CH35,
  advancedDiscourseTaskFamiliesReportSchema,
  type AdvancedDiscourseTaskFamiliesReport,
} from "@/lib/contracts/advancedDiscourseTaskFamiliesReport";

const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_PASS_THRESHOLD = 65;
const DEFAULT_STAGE_COVERAGE = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

type AttemptRow = {
  scoresJson: unknown;
  taskEvaluationJson: unknown;
  task: {
    type: string;
  } | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function scoreFromAttempt(row: AttemptRow) {
  const scoresJson = asObject(row.scoresJson);
  const scoreFromScores = scoresJson.taskScore;
  if (typeof scoreFromScores === "number" && Number.isFinite(scoreFromScores)) {
    return scoreFromScores;
  }

  const evaluationJson = asObject(row.taskEvaluationJson);
  const scoreFromEvaluation = evaluationJson.taskScore;
  if (typeof scoreFromEvaluation === "number" && Number.isFinite(scoreFromEvaluation)) {
    return scoreFromEvaluation;
  }
  return null;
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function buildCatalogRows(currentTaskFamilies: string[]) {
  const templateByType = new Map(
    TASK_TEMPLATES.map((template) => [template.type, template] as const),
  );

  return currentTaskFamilies.map((taskType) => {
    const fromTemplate = templateByType.get(taskType);
    const stageCoverage = uniqueSorted(
      asStringArray(fromTemplate?.meta?.recommendedStages).length > 0
        ? asStringArray(fromTemplate?.meta?.recommendedStages)
        : DEFAULT_STAGE_COVERAGE,
    );
    const classification = ADVANCED_DISCOURSE_TASK_FAMILIES.includes(
      taskType as (typeof ADVANCED_DISCOURSE_TASK_FAMILIES)[number],
    )
      ? "advanced_discourse"
      : BASELINE_TASK_FAMILIES_PRE_CH35.includes(
          taskType as (typeof BASELINE_TASK_FAMILIES_PRE_CH35)[number],
        )
      ? "baseline"
      : "other";
    return {
      taskType,
      classification,
      fromTemplateCatalog: Boolean(fromTemplate),
      supportsDiscoursePragmatics: isDiscoursePragmaticsTaskType(taskType),
      stageCoverage,
    };
  });
}

export function summarizeAdvancedDiscourseTaskFamiliesReport(params: {
  rows: AttemptRow[];
  windowDays: number;
  now?: Date;
}): AdvancedDiscourseTaskFamiliesReport {
  const now = params.now || new Date();
  const baselineTaskFamilies = [...BASELINE_TASK_FAMILIES_PRE_CH35].map((taskType) =>
    String(taskType),
  );
  const baselineTaskFamilySet = new Set(baselineTaskFamilies);
  const currentTaskFamilies = uniqueSorted(TASK_TEMPLATES.map((template) => template.type));

  const addedTaskFamilies = currentTaskFamilies.filter(
    (taskType) => !baselineTaskFamilySet.has(taskType),
  );
  const removedTaskFamilies = baselineTaskFamilies.filter(
    (taskType) => !currentTaskFamilies.includes(taskType),
  );

  const attemptsByFamily = new Map<string, { attempts: number; passedAttempts: number }>();
  for (const taskType of currentTaskFamilies) {
    attemptsByFamily.set(taskType, { attempts: 0, passedAttempts: 0 });
  }

  let attemptsConsidered = 0;
  let scoredAttempts = 0;

  for (const row of params.rows) {
    const taskType = row.task?.type || "";
    if (!attemptsByFamily.has(taskType)) continue;

    attemptsConsidered += 1;
    const score = scoreFromAttempt(row);
    if (typeof score !== "number") continue;

    scoredAttempts += 1;
    const stats = attemptsByFamily.get(taskType)!;
    stats.attempts += 1;
    if (score >= TASK_PASS_THRESHOLD) stats.passedAttempts += 1;
  }

  const passRateByTaskFamily = currentTaskFamilies
    .map((taskType) => {
      const stats = attemptsByFamily.get(taskType)!;
      return {
        taskType,
        attempts: stats.attempts,
        passedAttempts: stats.passedAttempts,
        passRate: ratioOrNull(stats.passedAttempts, stats.attempts),
      };
    })
    .sort((left, right) => {
      if (right.attempts !== left.attempts) return right.attempts - left.attempts;
      return left.taskType.localeCompare(right.taskType);
    });

  const catalogRows = buildCatalogRows(currentTaskFamilies).sort((left, right) =>
    left.taskType.localeCompare(right.taskType),
  );

  return advancedDiscourseTaskFamiliesReportSchema.parse({
    generatedAt: now.toISOString(),
    contractVersion: ADVANCED_DISCOURSE_TASK_FAMILIES_REPORT_VERSION,
    windowDays: params.windowDays,
    baselineTaskFamilies,
    currentTaskFamilies,
    addedTaskFamilies,
    removedTaskFamilies,
    catalogRows,
    passRateByTaskFamily,
    totals: {
      attemptsConsidered,
      scoredAttempts,
    },
  });
}

export async function buildAdvancedDiscourseTaskFamiliesReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<AdvancedDiscourseTaskFamiliesReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.attempt.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ["completed", "needs_retry"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      scoresJson: true,
      taskEvaluationJson: true,
      task: {
        select: {
          type: true,
        },
      },
    },
  });

  return summarizeAdvancedDiscourseTaskFamiliesReport({
    rows,
    windowDays,
    now,
  });
}
