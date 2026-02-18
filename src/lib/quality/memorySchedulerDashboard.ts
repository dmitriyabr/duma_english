import { prisma } from "@/lib/db";
import {
  memorySchedulerDashboardSchema,
  type MemorySchedulerDashboardReport,
} from "@/lib/contracts/memorySchedulerDashboard";
import {
  MEMORY_FRESH_QUEUE_TYPE,
  MEMORY_REVIEW_QUEUE_TYPE,
  MEMORY_SCHEDULER_VERSION,
} from "@/lib/memory/scheduler";
import { TRANSFER_REMEDIATION_QUEUE_TYPE } from "@/lib/ood/transferRemediationQueue";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ["pending", "scheduled"] as const;

type PortfolioKey = "fresh" | "review" | "transfer";

type DashboardRow = {
  queueType: string;
  status: string;
  reasonCode: string | null;
  dueAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  metadataJson: unknown;
};

type PortfolioAccumulator = {
  openCount: number;
  overdueOpenCount: number;
  completedCount: number;
  dueMissCount: number;
  resolutionLatenciesHours: number[];
  openAgesHours: number[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Number(sorted[mid]!.toFixed(4));
  return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(4));
}

function isOpenStatus(status: string) {
  return OPEN_STATUSES.includes(status as (typeof OPEN_STATUSES)[number]);
}

function toPortfolio(queueType: string): PortfolioKey | null {
  if (queueType === MEMORY_FRESH_QUEUE_TYPE) return "fresh";
  if (queueType === MEMORY_REVIEW_QUEUE_TYPE) return "review";
  if (queueType === TRANSFER_REMEDIATION_QUEUE_TYPE) return "transfer";
  return null;
}

function isFragileOpenRow(row: DashboardRow) {
  if (!isOpenStatus(row.status)) return false;
  const metadata = asObject(row.metadataJson);
  const scheduler = asObject(metadata.memoryScheduler);
  return scheduler.isFragileNode === true;
}

function buildPortfolioAccumulator(): PortfolioAccumulator {
  return {
    openCount: 0,
    overdueOpenCount: 0,
    completedCount: 0,
    dueMissCount: 0,
    resolutionLatenciesHours: [],
    openAgesHours: [],
  };
}

function pushLatencyHours(
  values: number[],
  from: Date,
  to: Date,
) {
  const latencyHours = (to.getTime() - from.getTime()) / (60 * 60 * 1000);
  if (Number.isFinite(latencyHours) && latencyHours >= 0) {
    values.push(latencyHours);
  }
}

export function summarizeMemorySchedulerRows(params: {
  rows: DashboardRow[];
  windowDays: number;
  now?: Date;
}): MemorySchedulerDashboardReport {
  const now = params.now || new Date();

  const totals = {
    openCount: 0,
    overdueOpenCount: 0,
    dueMissCount: 0,
    fragileOpenCount: 0,
  };

  const globalResolutionLatenciesHours: number[] = [];
  const globalOpenAgesHours: number[] = [];

  const reasonCounts = new Map<string, number>();
  const byPortfolio: Record<PortfolioKey, PortfolioAccumulator> = {
    fresh: buildPortfolioAccumulator(),
    review: buildPortfolioAccumulator(),
    transfer: buildPortfolioAccumulator(),
  };

  for (const row of params.rows) {
    const portfolio = toPortfolio(row.queueType);
    if (!portfolio) continue;

    const reasonKey = row.reasonCode || "unknown";
    reasonCounts.set(reasonKey, (reasonCounts.get(reasonKey) || 0) + 1);

    const acc = byPortfolio[portfolio];
    const open = isOpenStatus(row.status);
    const overdueOpen = open && row.dueAt < now;
    const completedLate =
      row.status === "completed" &&
      row.completedAt !== null &&
      row.completedAt > row.dueAt;

    if (open) {
      totals.openCount += 1;
      acc.openCount += 1;
      pushLatencyHours(acc.openAgesHours, row.createdAt, now);
      pushLatencyHours(globalOpenAgesHours, row.createdAt, now);
    }

    if (overdueOpen) {
      totals.overdueOpenCount += 1;
      acc.overdueOpenCount += 1;
    }

    if (row.status === "completed") {
      acc.completedCount += 1;
      if (row.completedAt) {
        pushLatencyHours(acc.resolutionLatenciesHours, row.createdAt, row.completedAt);
        pushLatencyHours(globalResolutionLatenciesHours, row.createdAt, row.completedAt);
      }
    }

    if (overdueOpen || completedLate) {
      totals.dueMissCount += 1;
      acc.dueMissCount += 1;
    }

    if (isFragileOpenRow(row)) {
      totals.fragileOpenCount += 1;
    }
  }

  const report = {
    generatedAt: now.toISOString(),
    schedulerVersion: MEMORY_SCHEDULER_VERSION,
    windowDays: params.windowDays,
    totalQueueItems: params.rows.length,
    openCount: totals.openCount,
    overdueOpenCount: totals.overdueOpenCount,
    dueMissCount: totals.dueMissCount,
    dueMissRate:
      params.rows.length > 0
        ? Number((totals.dueMissCount / params.rows.length).toFixed(6))
        : null,
    medianResolutionLatencyHours: median(globalResolutionLatenciesHours),
    medianOpenAgeHours: median(globalOpenAgesHours),
    fragileOpenCount: totals.fragileOpenCount,
    portfolio: (Object.keys(byPortfolio) as PortfolioKey[]).map((key) => {
      const acc = byPortfolio[key];
      return {
        portfolio: key,
        openCount: acc.openCount,
        overdueOpenCount: acc.overdueOpenCount,
        completedCount: acc.completedCount,
        dueMissCount: acc.dueMissCount,
        medianResolutionLatencyHours: median(acc.resolutionLatenciesHours),
        medianOpenAgeHours: median(acc.openAgesHours),
      };
    }),
    reasonBreakdown: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
  };

  return memorySchedulerDashboardSchema.parse(report);
}

export async function buildMemorySchedulerDashboardReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<MemorySchedulerDashboardReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.reviewQueueItem.findMany({
    where: {
      queueType: {
        in: [
          MEMORY_FRESH_QUEUE_TYPE,
          MEMORY_REVIEW_QUEUE_TYPE,
          TRANSFER_REMEDIATION_QUEUE_TYPE,
        ],
      },
      OR: [{ createdAt: { gte: since } }, { status: { in: [...OPEN_STATUSES] } }],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      queueType: true,
      status: true,
      reasonCode: true,
      dueAt: true,
      createdAt: true,
      completedAt: true,
      metadataJson: true,
    },
  });

  return summarizeMemorySchedulerRows({
    rows,
    windowDays,
    now,
  });
}
