import { prisma } from "@/lib/db";
import {
  fastLaneCohortReportSchema,
  type FastLaneCohortReport,
} from "@/lib/contracts/fastLaneCohortReport";
import { FAST_LANE_PROTOCOL_VERSION } from "@/lib/policy/fastLane";

const DAY_MS = 24 * 60 * 60 * 1000;

type CohortKey = "fast_lane" | "standard";

type ReportRow = {
  studentId: string;
  createdAt: Date;
  metaJson: unknown;
  oodVerdict: string | null;
  latestAttemptStatus: string | null;
};

type CohortAccumulator = {
  learners: Set<string>;
  tasks: number;
  diagnosticTasks: number;
  oodInjectedTasks: number;
  transferFailCount: number;
  transferEvaluatedCount: number;
  needsRetryCount: number;
  attemptedTaskCount: number;
  taskTimesByLearner: Map<string, Date[]>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeVerdict(verdict: string | null) {
  if (!verdict) return "unknown" as const;
  const normalized = verdict.trim().toLowerCase();
  if (!normalized) return "unknown" as const;
  if (normalized.includes("pass")) return "pass" as const;
  if (normalized.includes("fail")) return "fail" as const;
  return "unknown" as const;
}

function isDiagnosticTask(metaJson: unknown) {
  const meta = asObject(metaJson);
  const selectionReasonType = asString(meta.selectionReasonType);
  const disambiguationProbe = asObject(meta.causalDisambiguationProbe);
  return selectionReasonType === "verification" || disambiguationProbe.enabled === true;
}

function isFastLaneTask(metaJson: unknown) {
  const meta = asObject(metaJson);
  const fastLane = asObject(meta.fastLane);
  return fastLane.eligible === true || fastLane.applied === true;
}

function computeMedianInterTaskHours(taskTimesByLearner: Map<string, Date[]>) {
  const deltas: number[] = [];
  for (const taskTimes of taskTimesByLearner.values()) {
    const sorted = [...taskTimes].sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < sorted.length; i += 1) {
      const deltaHours = (sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / (60 * 60 * 1000);
      if (Number.isFinite(deltaHours) && deltaHours >= 0) {
        deltas.push(deltaHours);
      }
    }
  }
  if (deltas.length === 0) return null;
  const sorted = deltas.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Number(sorted[mid]!.toFixed(4));
  return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(4));
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function buildEmptyAccumulator(): CohortAccumulator {
  return {
    learners: new Set<string>(),
    tasks: 0,
    diagnosticTasks: 0,
    oodInjectedTasks: 0,
    transferFailCount: 0,
    transferEvaluatedCount: 0,
    needsRetryCount: 0,
    attemptedTaskCount: 0,
    taskTimesByLearner: new Map<string, Date[]>(),
  };
}

function addTaskTime(acc: CohortAccumulator, studentId: string, createdAt: Date) {
  const current = acc.taskTimesByLearner.get(studentId) || [];
  current.push(createdAt);
  acc.taskTimesByLearner.set(studentId, current);
}

function summarizeCohort(params: {
  cohort: CohortKey;
  acc: CohortAccumulator;
  windowDays: number;
}) {
  const learners = params.acc.learners.size;
  const tasks = params.acc.tasks;
  return {
    cohort: params.cohort,
    learners,
    tasks,
    tasksPerLearnerPerDay:
      learners > 0 ? Number((tasks / learners / Math.max(1, params.windowDays)).toFixed(6)) : 0,
    medianInterTaskHours: computeMedianInterTaskHours(params.acc.taskTimesByLearner),
    diagnosticTaskRate: tasks > 0 ? Number((params.acc.diagnosticTasks / tasks).toFixed(6)) : 0,
    oodInjectionRate: tasks > 0 ? Number((params.acc.oodInjectedTasks / tasks).toFixed(6)) : 0,
    transferFailRate: ratioOrNull(params.acc.transferFailCount, params.acc.transferEvaluatedCount),
    needsRetryRate: ratioOrNull(params.acc.needsRetryCount, params.acc.attemptedTaskCount),
  };
}

export function summarizeFastLaneCohorts(params: {
  rows: ReportRow[];
  windowDays: number;
  now?: Date;
}): FastLaneCohortReport {
  const now = params.now || new Date();
  const byCohort: Record<CohortKey, CohortAccumulator> = {
    fast_lane: buildEmptyAccumulator(),
    standard: buildEmptyAccumulator(),
  };

  for (const row of params.rows) {
    const cohort: CohortKey = isFastLaneTask(row.metaJson) ? "fast_lane" : "standard";
    const acc = byCohort[cohort];
    acc.learners.add(row.studentId);
    acc.tasks += 1;
    if (isDiagnosticTask(row.metaJson)) {
      acc.diagnosticTasks += 1;
    }
    addTaskTime(acc, row.studentId, row.createdAt);

    if (row.oodVerdict !== null) {
      acc.oodInjectedTasks += 1;
      const verdict = normalizeVerdict(row.oodVerdict);
      if (verdict === "fail") acc.transferFailCount += 1;
      if (verdict === "pass" || verdict === "fail") acc.transferEvaluatedCount += 1;
    }

    if (row.latestAttemptStatus !== null) {
      acc.attemptedTaskCount += 1;
      if (row.latestAttemptStatus === "needs_retry") {
        acc.needsRetryCount += 1;
      }
    }
  }

  const fastLane = summarizeCohort({
    cohort: "fast_lane",
    acc: byCohort.fast_lane,
    windowDays: params.windowDays,
  });
  const standard = summarizeCohort({
    cohort: "standard",
    acc: byCohort.standard,
    windowDays: params.windowDays,
  });

  const velocityLiftVsStandard =
    standard.tasksPerLearnerPerDay > 0
      ? Number(((fastLane.tasksPerLearnerPerDay - standard.tasksPerLearnerPerDay) / standard.tasksPerLearnerPerDay).toFixed(6))
      : null;

  const report = {
    generatedAt: now.toISOString(),
    protocolVersion: FAST_LANE_PROTOCOL_VERSION,
    windowDays: params.windowDays,
    totalLearners: new Set(params.rows.map((row) => row.studentId)).size,
    totalTasks: params.rows.length,
    cohorts: [fastLane, standard],
    deltas: {
      velocityLiftVsStandard,
      diagnosticRateDelta: Number((fastLane.diagnosticTaskRate - standard.diagnosticTaskRate).toFixed(6)),
      oodInjectionRateDelta: Number((fastLane.oodInjectionRate - standard.oodInjectionRate).toFixed(6)),
      transferFailRateDelta:
        fastLane.transferFailRate !== null && standard.transferFailRate !== null
          ? Number((fastLane.transferFailRate - standard.transferFailRate).toFixed(6))
          : null,
      needsRetryRateDelta:
        fastLane.needsRetryRate !== null && standard.needsRetryRate !== null
          ? Number((fastLane.needsRetryRate - standard.needsRetryRate).toFixed(6))
          : null,
    },
  };

  return fastLaneCohortReportSchema.parse(report);
}

export async function buildFastLaneCohortReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<FastLaneCohortReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.taskInstance.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      studentId: true,
      createdAt: true,
      task: {
        select: {
          metaJson: true,
          attempts: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
            },
          },
        },
      },
      oodTaskSpec: {
        select: {
          verdict: true,
        },
      },
    },
  });

  return summarizeFastLaneCohorts({
    windowDays,
    now,
    rows: rows.map((row) => ({
      studentId: row.studentId,
      createdAt: row.createdAt,
      metaJson: row.task?.metaJson || null,
      oodVerdict: row.oodTaskSpec?.verdict || null,
      latestAttemptStatus: row.task?.attempts[0]?.status || null,
    })),
  });
}
