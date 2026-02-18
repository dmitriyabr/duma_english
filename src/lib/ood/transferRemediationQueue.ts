import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TransferVerdict } from "@/lib/ood/transferVerdict";

export const TRANSFER_REMEDIATION_QUEUE_PROTOCOL_VERSION = "transfer-remediation-queue-v1" as const;
export const TRANSFER_REMEDIATION_QUEUE_TYPE = "transfer_remediation" as const;
export const TRANSFER_REMEDIATION_RECOVERY_WINDOW_DAYS = 14;
export const TRANSFER_REMEDIATION_DUE_HOURS = 72;

export type TransferRemediationQueueResult = {
  action: "enqueued" | "resolved" | "skipped";
  queueItemId: string | null;
  reason: string;
};

const ENQUEUE_VERDICTS: TransferVerdict[] = [
  "transfer_fail_validated",
  "inconclusive_control_missing",
];

const RECOVERY_VERDICTS: TransferVerdict[] = [
  "transfer_pass",
];

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function mergeMetadata(
  current: unknown,
  patch: Record<string, unknown>
) {
  return {
    ...asJsonObject(current),
    transferRemediationQueue: {
      ...asJsonObject(asJsonObject(current).transferRemediationQueue),
      ...patch,
    },
  };
}

export function shouldEnqueueTransferRemediation(verdict: TransferVerdict) {
  return ENQUEUE_VERDICTS.includes(verdict);
}

export function shouldResolveTransferRemediation(verdict: TransferVerdict) {
  return RECOVERY_VERDICTS.includes(verdict);
}

export function transferRemediationDueAt(now: Date, dueHours = TRANSFER_REMEDIATION_DUE_HOURS) {
  return new Date(now.getTime() + dueHours * 60 * 60 * 1000);
}

function remediationPriorityForVerdict(verdict: TransferVerdict) {
  if (verdict === "transfer_fail_validated") return 25;
  return 45;
}

export async function syncTransferRemediationQueueForVerdict(params: {
  studentId: string;
  attemptId: string;
  oodTaskSpecId: string;
  verdict: TransferVerdict;
  now?: Date;
}): Promise<TransferRemediationQueueResult> {
  const now = params.now || new Date();

  if (shouldResolveTransferRemediation(params.verdict)) {
    const openItem = await prisma.reviewQueueItem.findFirst({
      where: {
        studentId: params.studentId,
        queueType: TRANSFER_REMEDIATION_QUEUE_TYPE,
        status: { in: ["pending", "scheduled"] },
      },
      orderBy: [
        { dueAt: "asc" },
        { createdAt: "asc" },
      ],
    });
    if (!openItem) {
      return { action: "skipped", queueItemId: null, reason: "no_open_remediation_item" };
    }
    const nextMetadata = mergeMetadata(openItem.metadataJson, {
      protocolVersion: TRANSFER_REMEDIATION_QUEUE_PROTOCOL_VERSION,
      resolvedAt: now.toISOString(),
      resolvedByVerdict: params.verdict,
      resolvedByAttemptId: params.attemptId,
      resolvedByOodTaskSpecId: params.oodTaskSpecId,
      recoveryResolved: true,
    });
    const updated = await prisma.reviewQueueItem.update({
      where: { id: openItem.id },
      data: {
        status: "completed",
        completedAt: now,
        attemptId: params.attemptId,
        reasonCode: "recovered_transfer_pass",
        metadataJson: nextMetadata as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { action: "resolved", queueItemId: updated.id, reason: "transfer_pass_resolved_open_item" };
  }

  if (!shouldEnqueueTransferRemediation(params.verdict)) {
    return { action: "skipped", queueItemId: null, reason: "verdict_not_remediation_trigger" };
  }

  const sourceSpec = await prisma.oODTaskSpec.findUnique({
    where: { id: params.oodTaskSpecId },
    select: {
      id: true,
      taskInstanceId: true,
      taskInstance: {
        select: {
          targetNodeIds: true,
        },
      },
    },
  });
  if (!sourceSpec) {
    return { action: "skipped", queueItemId: null, reason: "missing_ood_task_spec" };
  }

  const targetNodeId = sourceSpec.taskInstance?.targetNodeIds?.[0] || null;
  if (!targetNodeId) {
    return { action: "skipped", queueItemId: null, reason: "missing_target_node" };
  }

  const existing = await prisma.reviewQueueItem.findFirst({
    where: {
      studentId: params.studentId,
      queueType: TRANSFER_REMEDIATION_QUEUE_TYPE,
      taskInstanceId: sourceSpec.taskInstanceId,
      status: { in: ["pending", "scheduled"] },
    },
    select: { id: true },
  });
  if (existing) {
    return { action: "skipped", queueItemId: existing.id, reason: "already_queued_for_source_task" };
  }

  const dueAt = transferRemediationDueAt(now);
  const metadata = {
    protocolVersion: TRANSFER_REMEDIATION_QUEUE_PROTOCOL_VERSION,
    sourceVerdict: params.verdict,
    sourceAttemptId: params.attemptId,
    sourceOodTaskSpecId: params.oodTaskSpecId,
    queuedAt: now.toISOString(),
    dueAt: dueAt.toISOString(),
    recoveryWindowDays: TRANSFER_REMEDIATION_RECOVERY_WINDOW_DAYS,
    requiresTransferRecheck: true,
    recoveryResolved: false,
  };
  const created = await prisma.reviewQueueItem.create({
    data: {
      studentId: params.studentId,
      nodeId: targetNodeId,
      queueType: TRANSFER_REMEDIATION_QUEUE_TYPE,
      status: "pending",
      reasonCode: params.verdict,
      priority: remediationPriorityForVerdict(params.verdict),
      dueAt,
      taskInstanceId: sourceSpec.taskInstanceId,
      attemptId: params.attemptId,
      metadataJson: metadata as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return { action: "enqueued", queueItemId: created.id, reason: params.verdict };
}
