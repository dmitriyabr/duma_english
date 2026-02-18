import { prisma } from "@/lib/db";
import {
  transferRemediationQueueDashboardSchema,
  type TransferRemediationQueueDashboard,
} from "@/lib/contracts/transferRemediationQueueDashboard";
import { TRANSFER_REMEDIATION_QUEUE_PROTOCOL_VERSION, TRANSFER_REMEDIATION_QUEUE_TYPE } from "@/lib/ood/transferRemediationQueue";

const DAY_MS = 24 * 60 * 60 * 1000;

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readRecoveryResolved(metadataJson: unknown) {
  const metadata = asJsonObject(metadataJson);
  const queueMeta = asJsonObject(metadata.transferRemediationQueue);
  return queueMeta.recoveryResolved === true;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

type DashboardRow = {
  status: string;
  reasonCode: string | null;
  dueAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  metadataJson: unknown;
};

export function summarizeTransferRemediationQueueRows(params: {
  rows: DashboardRow[];
  windowDays: number;
  now?: Date;
}): TransferRemediationQueueDashboard {
  const now = params.now || new Date();

  const statusCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();

  let pendingCount = 0;
  let scheduledCount = 0;
  let completedCount = 0;
  let overdueCount = 0;
  let completedOnTimeCount = 0;
  let recoveryResolvedCount = 0;

  const completionLatenciesHours: number[] = [];

  for (const row of params.rows) {
    const status = row.status || "unknown";
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    const reason = row.reasonCode || "unknown";
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);

    if (status === "pending") pendingCount += 1;
    if (status === "scheduled") scheduledCount += 1;

    if ((status === "pending" || status === "scheduled") && row.dueAt < now) {
      overdueCount += 1;
    }

    if (status === "completed") {
      completedCount += 1;
      if (row.completedAt && row.completedAt <= row.dueAt) {
        completedOnTimeCount += 1;
      }
      if (row.completedAt) {
        const latencyHours = (row.completedAt.getTime() - row.createdAt.getTime()) / (60 * 60 * 1000);
        if (Number.isFinite(latencyHours) && latencyHours >= 0) {
          completionLatenciesHours.push(latencyHours);
        }
      }
      if (readRecoveryResolved(row.metadataJson)) {
        recoveryResolvedCount += 1;
      }
    }
  }

  const totalQueueItems = params.rows.length;
  const slaBreachCount =
    overdueCount + Math.max(0, completedCount - completedOnTimeCount);
  const report = {
    generatedAt: now.toISOString(),
    protocolVersion: TRANSFER_REMEDIATION_QUEUE_PROTOCOL_VERSION,
    windowDays: params.windowDays,
    totalQueueItems,
    pendingCount,
    scheduledCount,
    completedCount,
    overdueCount,
    completedOnTimeCount,
    slaBreachCount,
    slaOnTimeCompletionRate:
      completedCount > 0 ? Number((completedOnTimeCount / completedCount).toFixed(6)) : null,
    recoveryResolvedCount,
    recoveryRate:
      completedCount > 0 ? Number((recoveryResolvedCount / completedCount).toFixed(6)) : null,
    medianResolutionLatencyHours: median(completionLatenciesHours),
    statusBreakdown: [...statusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    reasonBreakdown: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
  };

  return transferRemediationQueueDashboardSchema.parse(report);
}

export async function buildTransferRemediationQueueDashboard(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<TransferRemediationQueueDashboard> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(10, Math.min(50000, Math.floor(params?.limit ?? 5000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.reviewQueueItem.findMany({
    where: {
      queueType: TRANSFER_REMEDIATION_QUEUE_TYPE,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      status: true,
      reasonCode: true,
      dueAt: true,
      createdAt: true,
      completedAt: true,
      metadataJson: true,
    },
  });

  return summarizeTransferRemediationQueueRows({
    rows,
    windowDays,
    now,
  });
}
