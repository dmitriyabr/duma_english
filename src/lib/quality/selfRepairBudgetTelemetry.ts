import { prisma } from "@/lib/db";
import {
  SELF_REPAIR_BUDGET_GUARDRAILS_VERSION,
  SELF_REPAIR_ESCALATION_QUEUE_TYPE,
} from "@/lib/selfRepair/budgetGuardrails";
import {
  selfRepairBudgetTelemetryReportSchema,
  type SelfRepairBudgetTelemetryReport,
} from "@/lib/contracts/selfRepairBudgetTelemetry";

const DAY_MS = 24 * 60 * 60 * 1000;

type BudgetCycleRow = {
  status: string;
  metadataJson: unknown;
};

type EscalationQueueRow = {
  status: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function max(values: number[]) {
  if (values.length === 0) return null;
  return Number(Math.max(...values).toFixed(6));
}

export function summarizeSelfRepairBudgetTelemetry(params: {
  cycleRows: BudgetCycleRow[];
  escalationQueueRows: EscalationQueueRow[];
  windowDays: number;
  now?: Date;
}): SelfRepairBudgetTelemetryReport {
  const now = params.now || new Date();
  const reasons = new Map<string, number>();
  const projectedShares: number[] = [];
  const loopsUsed: number[] = [];

  let budgetExhaustedCount = 0;
  let escalatedCount = 0;

  for (const row of params.cycleRows) {
    if (row.status === "escalated") {
      escalatedCount += 1;
    }

    const metadata = asObject(row.metadataJson);
    const budget = asObject(metadata.budgetGuardrails);
    if (budget.exhausted === true) {
      budgetExhaustedCount += 1;
    }

    const projectedShare = asNumber(budget.projectedImmediateShare);
    if (projectedShare !== null) {
      projectedShares.push(projectedShare);
    }

    const loops = asNumber(budget.loopsUsedForSkillSession);
    if (loops !== null) {
      loopsUsed.push(loops);
    }

    const budgetReasons = asStringArray(budget.reasons);
    for (const reason of budgetReasons) {
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
  }

  const escalationQueueOpenCount = params.escalationQueueRows.filter((row) => row.status !== "completed").length;
  const escalationQueueCompletedCount = params.escalationQueueRows.filter((row) => row.status === "completed").length;

  const totalCycles = params.cycleRows.length;
  const report = {
    generatedAt: now.toISOString(),
    guardrailsVersion: SELF_REPAIR_BUDGET_GUARDRAILS_VERSION,
    windowDays: params.windowDays,
    totalCycles,
    budgetExhaustedCount,
    budgetExhaustedRate: totalCycles > 0 ? Number((budgetExhaustedCount / totalCycles).toFixed(6)) : 0,
    escalatedCount,
    escalationQueueOpenCount,
    escalationQueueCompletedCount,
    averageProjectedImmediateShare: average(projectedShares),
    maxProjectedImmediateShare: max(projectedShares),
    averageLoopsUsedPerSkillSession: average(loopsUsed),
    reasons: [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
  };

  return selfRepairBudgetTelemetryReportSchema.parse(report);
}

export async function buildSelfRepairBudgetTelemetryReport(params?: {
  windowDays?: number;
  cycleLimit?: number;
  queueLimit?: number;
  now?: Date;
}): Promise<SelfRepairBudgetTelemetryReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const cycleLimit = Math.max(10, Math.min(50000, Math.floor(params?.cycleLimit ?? 5000)));
  const queueLimit = Math.max(10, Math.min(50000, Math.floor(params?.queueLimit ?? 5000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const [cycleRows, escalationQueueRows] = await Promise.all([
    prisma.selfRepairCycle.findMany({
      where: {
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: cycleLimit,
      select: {
        status: true,
        metadataJson: true,
      },
    }),
    prisma.reviewQueueItem.findMany({
      where: {
        queueType: SELF_REPAIR_ESCALATION_QUEUE_TYPE,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: queueLimit,
      select: {
        status: true,
      },
    }),
  ]);

  return summarizeSelfRepairBudgetTelemetry({
    cycleRows,
    escalationQueueRows,
    windowDays,
    now,
  });
}
