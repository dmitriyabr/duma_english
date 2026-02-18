import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SELF_REPAIR_IMMEDIATE_LOOP_VERSION = "self-repair-immediate-v1" as const;
export const IMMEDIATE_SELF_REPAIR_TASK_SCORE_THRESHOLD = 70;

export type PendingImmediateSelfRepairCycle = {
  cycleId: string;
  sourceAttemptId: string;
  sourceTaskId: string;
  sourceTaskType: string;
  sourcePrompt: string;
  sourceTaskScore: number | null;
  sourceTargetNodeIds: string[];
  sourceTaskInstanceId: string | null;
  causeLabel: string | null;
  feedback: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function parseTaskScore(taskEvaluationJson: unknown) {
  const row = asRecord(taskEvaluationJson);
  const taskScore = row.taskScore;
  if (typeof taskScore !== "number" || !Number.isFinite(taskScore)) return null;
  return Math.max(0, Math.min(100, taskScore));
}

export function shouldTriggerImmediateSelfRepair(params: {
  taskType: string;
  taskMeta: Record<string, unknown>;
  taskEvaluation: unknown;
}): boolean {
  const selfRepair = asRecord(params.taskMeta.selfRepair);
  if (asString(selfRepair.mode) === "immediate_retry") {
    return false;
  }

  if (params.taskType === "read_aloud") {
    return false;
  }

  const taskScore = parseTaskScore(params.taskEvaluation);
  if (taskScore === null) return false;

  return taskScore < IMMEDIATE_SELF_REPAIR_TASK_SCORE_THRESHOLD;
}

export async function findPendingImmediateSelfRepairCycle(
  studentId: string
): Promise<PendingImmediateSelfRepairCycle | null> {
  const cycle = await prisma.selfRepairCycle.findFirst({
    where: {
      studentId,
      status: "pending_immediate_retry",
      immediateAttemptId: null,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sourceAttemptId: true,
      causeLabel: true,
      feedbackJson: true,
      metadataJson: true,
      sourceAttempt: {
        select: {
          taskId: true,
          taskEvaluationJson: true,
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

  if (!cycle?.sourceAttempt?.task) return null;

  const sourceTaskId = cycle.sourceAttempt.taskId;
  const sourceTaskInstance = await prisma.taskInstance.findUnique({
    where: { taskId: sourceTaskId },
    select: {
      id: true,
      targetNodeIds: true,
    },
  });

  const metadata = asRecord(cycle.metadataJson);
  const metadataTargetNodeIds = asStringArray(metadata.sourceTargetNodeIds);

  return {
    cycleId: cycle.id,
    sourceAttemptId: cycle.sourceAttemptId,
    sourceTaskId,
    sourceTaskType: cycle.sourceAttempt.task.type,
    sourcePrompt: cycle.sourceAttempt.task.prompt,
    sourceTaskScore: parseTaskScore(cycle.sourceAttempt.taskEvaluationJson),
    sourceTargetNodeIds:
      sourceTaskInstance?.targetNodeIds && sourceTaskInstance.targetNodeIds.length > 0
        ? sourceTaskInstance.targetNodeIds
        : metadataTargetNodeIds,
    sourceTaskInstanceId: sourceTaskInstance?.id || null,
    causeLabel: cycle.causeLabel,
    feedback: cycle.feedbackJson,
  };
}

export async function createImmediateSelfRepairCycle(params: {
  attemptId: string;
  studentId: string;
  taskId: string;
  taskType: string;
  taskPrompt: string;
  taskMeta: Record<string, unknown>;
  taskEvaluation: unknown;
  feedback: unknown;
  causeLabel: string | null;
  sourceTargetNodeIds: string[];
  sourceTaskInstanceId: string | null;
}): Promise<{ cycleId: string; created: boolean } | null> {
  if (
    !shouldTriggerImmediateSelfRepair({
      taskType: params.taskType,
      taskMeta: params.taskMeta,
      taskEvaluation: params.taskEvaluation,
    })
  ) {
    return null;
  }

  const existing = await prisma.selfRepairCycle.findUnique({
    where: {
      sourceAttemptId_loopIndex: {
        sourceAttemptId: params.attemptId,
        loopIndex: 1,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { cycleId: existing.id, created: false };
  }

  const taskScore = parseTaskScore(params.taskEvaluation);
  const cycle = await prisma.selfRepairCycle.create({
    data: {
      studentId: params.studentId,
      sourceAttemptId: params.attemptId,
      nodeId: params.sourceTargetNodeIds[0] || null,
      loopIndex: 1,
      status: "pending_immediate_retry",
      causeLabel: params.causeLabel || null,
      feedbackJson: ((params.feedback as Prisma.InputJsonValue) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      metadataJson: {
        protocolVersion: SELF_REPAIR_IMMEDIATE_LOOP_VERSION,
        sourceTaskId: params.taskId,
        sourceTaskType: params.taskType,
        sourcePrompt: params.taskPrompt,
        sourceTaskScore: taskScore,
        sourceTargetNodeIds: params.sourceTargetNodeIds,
        sourceTaskInstanceId: params.sourceTaskInstanceId,
        immediateRepairTaskType: params.taskType,
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return {
    cycleId: cycle.id,
    created: true,
  };
}

export async function completeImmediateSelfRepairCycle(params: {
  attemptId: string;
  studentId: string;
  taskMeta: Record<string, unknown>;
  taskEvaluation: unknown;
  now?: Date;
}): Promise<{ cycleId: string; status: string } | null> {
  const selfRepair = asRecord(params.taskMeta.selfRepair);
  if (asString(selfRepair.mode) !== "immediate_retry") return null;

  const cycleId = asString(selfRepair.cycleId);
  if (!cycleId) return null;

  const cycle = await prisma.selfRepairCycle.findUnique({
    where: { id: cycleId },
    select: {
      id: true,
      studentId: true,
      status: true,
      metadataJson: true,
    },
  });
  if (!cycle || cycle.studentId !== params.studentId) return null;
  if (cycle.status !== "pending_immediate_retry") {
    return { cycleId: cycle.id, status: cycle.status };
  }

  const now = params.now || new Date();
  const taskScore = parseTaskScore(params.taskEvaluation);
  const existingMetadata = asRecord(cycle.metadataJson);

  const updated = await prisma.selfRepairCycle.update({
    where: { id: cycle.id },
    data: {
      immediateAttemptId: params.attemptId,
      status: "pending_delayed_verification",
      metadataJson: {
        ...existingMetadata,
        immediateCompletedAt: now.toISOString(),
        immediateAttemptId: params.attemptId,
        immediateTaskScore: taskScore,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      status: true,
    },
  });

  return {
    cycleId: updated.id,
    status: updated.status,
  };
}

export function buildImmediateSelfRepairPrompt(params: {
  sourcePrompt: string;
  causeLabel: string | null;
  feedback: unknown;
}) {
  const feedback = asRecord(params.feedback);
  const feedbackMessage = asString(feedback.message) || asString(feedback.short) || null;
  const causeHint = params.causeLabel ? `Main issue: ${params.causeLabel}.` : "";
  const feedbackHint = feedbackMessage ? `Fix hint: ${feedbackMessage}` : "Fix the main mistake from the previous attempt.";

  return `Immediate self-repair retry. ${causeHint} ${feedbackHint} Repeat the same task with a corrected answer: ${params.sourcePrompt}`
    .replace(/\s+/g, " ")
    .trim();
}
