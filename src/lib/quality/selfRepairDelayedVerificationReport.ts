import { prisma } from "@/lib/db";
import {
  selfRepairDelayedVerificationReportSchema,
  type SelfRepairDelayedVerificationReport,
} from "@/lib/contracts/selfRepairDelayedVerificationReport";
import {
  SELF_REPAIR_DELAYED_VERIFICATION_VERSION,
  validateDelayedVerificationNonDuplicate,
} from "@/lib/selfRepair/delayedVerification";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type RawRow = {
  createdAt: Date;
  status: string;
  delayedVerificationTaskInstanceId: string | null;
  delayedVerificationAttemptId: string | null;
  metadataJson: unknown;
  sourceAttempt: {
    task: {
      type: string;
      prompt: string;
    } | null;
  } | null;
  delayedVerificationAttempt: {
    task: {
      type: string;
      prompt: string;
    } | null;
  } | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function summarizeRows(params: {
  rows: RawRow[];
  windowDays: number;
  staleThresholdHours: number;
  now: Date;
}): SelfRepairDelayedVerificationReport {
  let pendingDelayedCount = 0;
  let delayedAttemptLinkedCount = 0;
  let validVerificationCount = 0;
  let invalidVerificationCount = 0;
  let invalidDuplicateTaskFamilyCount = 0;
  let invalidDuplicatePromptCount = 0;
  let missingDelayedVerificationCount = 0;
  const reasonCounts = new Map<string, number>();

  for (const row of params.rows) {
    if (row.status === "pending_delayed_verification") {
      pendingDelayedCount += 1;
    }

    const metadata = asRecord(row.metadataJson);
    const sourceTaskType =
      asString(metadata.sourceTaskType) || row.sourceAttempt?.task?.type || null;
    const sourcePrompt =
      asString(metadata.sourcePrompt) || row.sourceAttempt?.task?.prompt || null;
    const delayedTaskType =
      row.delayedVerificationAttempt?.task?.type ||
      asString(metadata.delayedVerificationTaskType) ||
      null;
    const delayedPrompt =
      row.delayedVerificationAttempt?.task?.prompt ||
      asString(metadata.delayedVerificationPrompt) ||
      null;

    if (row.delayedVerificationAttemptId) {
      delayedAttemptLinkedCount += 1;
      const validation = validateDelayedVerificationNonDuplicate({
        sourceTaskType,
        delayedTaskType,
        sourcePrompt,
        delayedPrompt,
      });
      if (validation.valid) {
        validVerificationCount += 1;
      } else {
        invalidVerificationCount += 1;
        if (validation.duplicateTaskFamily) invalidDuplicateTaskFamilyCount += 1;
        if (validation.duplicatePromptFormulation) invalidDuplicatePromptCount += 1;
        for (const reason of validation.reasons) {
          reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
        }
      }
      continue;
    }

    const ageHours = (params.now.getTime() - row.createdAt.getTime()) / HOUR_MS;
    if (row.status === "pending_delayed_verification" && ageHours >= params.staleThresholdHours) {
      invalidVerificationCount += 1;
      missingDelayedVerificationCount += 1;
      reasonCounts.set(
        "missing_delayed_verification",
        (reasonCounts.get("missing_delayed_verification") || 0) + 1
      );
    }
  }

  const totalCycles = params.rows.length;

  return selfRepairDelayedVerificationReportSchema.parse({
    generatedAt: params.now.toISOString(),
    protocolVersion: SELF_REPAIR_DELAYED_VERIFICATION_VERSION,
    windowDays: params.windowDays,
    staleThresholdHours: params.staleThresholdHours,
    totalCycles,
    pendingDelayedCount,
    delayedAttemptLinkedCount,
    validVerificationCount,
    invalidVerificationCount,
    invalidDuplicateTaskFamilyCount,
    invalidDuplicatePromptCount,
    missingDelayedVerificationCount,
    invalidRate: totalCycles > 0 ? round(invalidVerificationCount / totalCycles) : 0,
    reasonCounts: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
  });
}

export async function buildSelfRepairDelayedVerificationReport(params?: {
  windowDays?: number;
  limit?: number;
  staleThresholdHours?: number;
  now?: Date;
}): Promise<SelfRepairDelayedVerificationReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(10, Math.min(50000, Math.floor(params?.limit ?? 5000)));
  const staleThresholdHours = Math.max(
    1,
    Math.min(24 * 30, Math.floor(params?.staleThresholdHours ?? 72))
  );
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.selfRepairCycle.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      createdAt: true,
      status: true,
      delayedVerificationTaskInstanceId: true,
      delayedVerificationAttemptId: true,
      metadataJson: true,
      sourceAttempt: {
        select: {
          task: {
            select: {
              type: true,
              prompt: true,
            },
          },
        },
      },
      delayedVerificationAttempt: {
        select: {
          task: {
            select: {
              type: true,
              prompt: true,
            },
          },
        },
      },
    },
  });

  return summarizeRows({
    rows,
    windowDays,
    staleThresholdHours,
    now,
  });
}

export const __internal = {
  summarizeRows,
};
