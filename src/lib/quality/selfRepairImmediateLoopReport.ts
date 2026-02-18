import { prisma } from "@/lib/db";
import {
  selfRepairImmediateLoopReportSchema,
  type SelfRepairImmediateLoopReport,
} from "@/lib/contracts/selfRepairImmediateLoopReport";
import { SELF_REPAIR_IMMEDIATE_LOOP_VERSION } from "@/lib/selfRepair/immediateLoop";

const DAY_MS = 24 * 60 * 60 * 1000;

type SelfRepairRawRow = {
  status: string;
  causeLabel: string | null;
  sourceAttempt: {
    completedAt: Date | null;
  } | null;
  immediateAttempt: {
    completedAt: Date | null;
  } | null;
};

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function summarizeRows(params: {
  rows: SelfRepairRawRow[];
  windowDays: number;
  now: Date;
}): SelfRepairImmediateLoopReport {
  let immediateCompletedCount = 0;
  let pendingImmediateCount = 0;
  let pendingDelayedCount = 0;
  let completedCount = 0;
  let escalatedCount = 0;
  let cancelledCount = 0;
  const causeCounts = new Map<string, number>();
  const latencyMinutes: number[] = [];

  for (const row of params.rows) {
    const causeLabel = row.causeLabel || "unknown";
    causeCounts.set(causeLabel, (causeCounts.get(causeLabel) || 0) + 1);

    if (row.status === "pending_immediate_retry") {
      pendingImmediateCount += 1;
    } else if (row.status === "pending_delayed_verification") {
      pendingDelayedCount += 1;
    } else if (row.status === "completed") {
      completedCount += 1;
    } else if (row.status === "escalated") {
      escalatedCount += 1;
    } else if (row.status === "cancelled") {
      cancelledCount += 1;
    }

    if (row.immediateAttempt) {
      immediateCompletedCount += 1;
      const sourceCompletedAt = row.sourceAttempt?.completedAt;
      const immediateCompletedAt = row.immediateAttempt.completedAt;
      if (sourceCompletedAt && immediateCompletedAt) {
        const deltaMinutes = (immediateCompletedAt.getTime() - sourceCompletedAt.getTime()) / (60 * 1000);
        if (Number.isFinite(deltaMinutes) && deltaMinutes >= 0) {
          latencyMinutes.push(deltaMinutes);
        }
      }
    }
  }

  const totalCycles = params.rows.length;

  return selfRepairImmediateLoopReportSchema.parse({
    generatedAt: params.now.toISOString(),
    protocolVersion: SELF_REPAIR_IMMEDIATE_LOOP_VERSION,
    windowDays: params.windowDays,
    totalCycles,
    immediateCompletedCount,
    immediateCompletionRate: totalCycles > 0 ? round(immediateCompletedCount / totalCycles) : 0,
    pendingImmediateCount,
    pendingDelayedCount,
    completedCount,
    escalatedCount,
    cancelledCount,
    medianImmediateLatencyMinutes:
      latencyMinutes.length > 0 ? round(median(latencyMinutes) || 0, 2) : null,
    causeLabels: [...causeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([causeLabel, count]) => ({ causeLabel, count })),
  });
}

export async function buildSelfRepairImmediateLoopReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<SelfRepairImmediateLoopReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(10, Math.min(50000, Math.floor(params?.limit ?? 5000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.selfRepairCycle.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      status: true,
      causeLabel: true,
      sourceAttempt: {
        select: {
          completedAt: true,
        },
      },
      immediateAttempt: {
        select: {
          completedAt: true,
        },
      },
    },
  });

  return summarizeRows({
    rows,
    windowDays,
    now,
  });
}

export const __internal = {
  summarizeRows,
};
