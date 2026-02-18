import { prisma } from "@/lib/db";
import {
  OOD_BUDGET_CONTROLLER_VERSION,
  OOD_BUDGET_MAX_RATE,
  OOD_BUDGET_MIN_RATE,
} from "@/lib/ood/budgetController";
import {
  oodBudgetTelemetryReportSchema,
  type OodBudgetTelemetryReport,
} from "@/lib/contracts/oodBudgetTelemetry";

const DAY_MS = 24 * 60 * 60 * 1000;

type LearnerAccumulator = {
  studentId: string;
  totalTasks: number;
  oodInjectedTasks: number;
  budgetRateSamples: number[];
  budgetIntervalSamples: number[];
  milestonePressureTasks: number;
  overfitRiskTasks: number;
  evaluatedOodCount: number;
  oodPassCount: number;
  oodFailCount: number;
};

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeVerdict(verdict: string | null) {
  if (!verdict) return "unknown" as const;
  const normalized = verdict.trim().toLowerCase();
  if (!normalized) return "unknown" as const;
  if (normalized.includes("pass") || normalized.includes("success")) return "pass" as const;
  if (normalized.includes("fail")) return "fail" as const;
  return "unknown" as const;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

export async function buildOodBudgetTelemetryReport(params?: {
  windowDays?: number;
  limit?: number;
}): Promise<OodBudgetTelemetryReport> {
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const taskRows = await prisma.taskInstance.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      studentId: true,
      task: {
        select: {
          metaJson: true,
        },
      },
      oodTaskSpec: {
        select: {
          verdict: true,
          status: true,
        },
      },
    },
  });

  const byLearner = new Map<string, LearnerAccumulator>();
  for (const row of taskRows) {
    if (!byLearner.has(row.studentId)) {
      byLearner.set(row.studentId, {
        studentId: row.studentId,
        totalTasks: 0,
        oodInjectedTasks: 0,
        budgetRateSamples: [],
        budgetIntervalSamples: [],
        milestonePressureTasks: 0,
        overfitRiskTasks: 0,
        evaluatedOodCount: 0,
        oodPassCount: 0,
        oodFailCount: 0,
      });
    }
    const acc = byLearner.get(row.studentId)!;
    acc.totalTasks += 1;

    const meta = asJsonObject(row.task?.metaJson);
    const budget = asJsonObject(meta.oodBudgetController);
    const budgetRate = toFiniteNumber(budget.budgetRate);
    const budgetInterval = toFiniteNumber(budget.interval);
    if (budgetRate !== null) acc.budgetRateSamples.push(budgetRate);
    if (budgetInterval !== null) acc.budgetIntervalSamples.push(budgetInterval);
    if (budget.milestonePressure === true) acc.milestonePressureTasks += 1;
    if (budget.overfitRisk === true) acc.overfitRiskTasks += 1;

    if (row.oodTaskSpec) {
      acc.oodInjectedTasks += 1;
      if (row.oodTaskSpec.status === "evaluated" || typeof row.oodTaskSpec.verdict === "string") {
        acc.evaluatedOodCount += 1;
      }
      const normalized = normalizeVerdict(row.oodTaskSpec.verdict);
      if (normalized === "pass") acc.oodPassCount += 1;
      if (normalized === "fail") acc.oodFailCount += 1;
    }
  }

  const learners = [...byLearner.values()]
    .map((acc) => {
      const realizedOodRate = acc.totalTasks > 0 ? Number((acc.oodInjectedTasks / acc.totalTasks).toFixed(6)) : 0;
      const averageBudgetRate = average(acc.budgetRateSamples);
      const averageBudgetInterval = average(acc.budgetIntervalSamples);
      return {
        studentId: acc.studentId,
        totalTasks: acc.totalTasks,
        oodInjectedTasks: acc.oodInjectedTasks,
        realizedOodRate,
        averageBudgetRate,
        averageBudgetInterval,
        milestonePressureTasks: acc.milestonePressureTasks,
        overfitRiskTasks: acc.overfitRiskTasks,
        evaluatedOodCount: acc.evaluatedOodCount,
        oodPassCount: acc.oodPassCount,
        oodFailCount: acc.oodFailCount,
        outsideBudgetBand: realizedOodRate > 0 && (realizedOodRate < OOD_BUDGET_MIN_RATE || realizedOodRate > OOD_BUDGET_MAX_RATE),
      };
    })
    .sort((a, b) => b.totalTasks - a.totalTasks);

  const totalTasks = learners.reduce((sum, row) => sum + row.totalTasks, 0);
  const totalOodInjectedTasks = learners.reduce((sum, row) => sum + row.oodInjectedTasks, 0);
  const summary = {
    totalTasks,
    totalOodInjectedTasks,
    realizedOodRate:
      totalTasks > 0 ? Number((totalOodInjectedTasks / totalTasks).toFixed(6)) : 0,
    learnersOutsideBudgetBand: learners.filter((row) => row.outsideBudgetBand).length,
  };

  return oodBudgetTelemetryReportSchema.parse({
    generatedAt: new Date().toISOString(),
    controllerVersion: OOD_BUDGET_CONTROLLER_VERSION,
    targetBudgetBand: {
      minRate: OOD_BUDGET_MIN_RATE,
      maxRate: OOD_BUDGET_MAX_RATE,
    },
    windowDays,
    totalLearners: learners.length,
    summary,
    learners,
  });
}
