import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SELF_REPAIR_DELAYED_VERIFICATION_VERSION =
  "self-repair-delayed-verification-v1" as const;

const DEFAULT_PROMPT_SIMILARITY_THRESHOLD = 0.88;

export type PendingDelayedSelfRepairCycle = {
  cycleId: string;
  sourceAttemptId: string;
  sourceTaskType: string;
  sourcePrompt: string;
  sourceTaskInstanceId: string | null;
  sourceTargetNodeIds: string[];
  verificationTaskType: string;
  causeLabel: string | null;
};

export type DelayedVerificationValidation = {
  valid: boolean;
  reasons: string[];
  duplicateTaskFamily: boolean;
  duplicatePromptFormulation: boolean;
  promptSimilarity: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function normalizePromptText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function promptSimilarity(left: string, right: string) {
  const leftNormalized = normalizePromptText(left);
  const rightNormalized = normalizePromptText(right);
  if (!leftNormalized || !rightNormalized) return 0;

  const leftTokens = new Set(leftNormalized.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(rightNormalized.split(" ").filter((token) => token.length > 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return leftNormalized === rightNormalized ? 1 : 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  const union = new Set([...leftTokens, ...rightTokens]);
  return union.size > 0 ? intersection / union.size : 0;
}

export function selectDelayedVerificationTaskType(sourceTaskType: string) {
  const map: Record<string, string> = {
    target_vocab: "qa_prompt",
    qa_prompt: "role_play",
    role_play: "qa_prompt",
    topic_talk: "qa_prompt",
    filler_control: "speech_builder",
    speech_builder: "qa_prompt",
    read_aloud: "qa_prompt",
  };
  return map[sourceTaskType] || "qa_prompt";
}

export function buildDelayedVerificationPrompt(params: {
  sourcePrompt: string;
  generatedPrompt: string;
  verificationTaskType: string;
}) {
  const generated = params.generatedPrompt.trim();
  const base =
    generated.length > 0
      ? generated
      : `Demonstrate the corrected skill in a new context using ${params.verificationTaskType}.`;

  return (
    `Delayed verification check. Use a different task framing from the immediate retry, ` +
    `and do not repeat the previous wording. ${base}`
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function validateDelayedVerificationNonDuplicate(params: {
  sourceTaskType: string | null | undefined;
  delayedTaskType: string | null | undefined;
  sourcePrompt: string | null | undefined;
  delayedPrompt: string | null | undefined;
  promptSimilarityThreshold?: number;
}): DelayedVerificationValidation {
  const reasons: string[] = [];
  const sourceTaskType = asString(params.sourceTaskType);
  const delayedTaskType = asString(params.delayedTaskType);
  const sourcePrompt = asString(params.sourcePrompt);
  const delayedPrompt = asString(params.delayedPrompt);
  const threshold =
    typeof params.promptSimilarityThreshold === "number" && Number.isFinite(params.promptSimilarityThreshold)
      ? Math.max(0, Math.min(1, params.promptSimilarityThreshold))
      : DEFAULT_PROMPT_SIMILARITY_THRESHOLD;

  let similarity: number | null = null;
  let duplicateTaskFamily = false;
  let duplicatePromptFormulation = false;

  if (!sourceTaskType || !delayedTaskType) {
    reasons.push("missing_task_family_context");
  } else if (sourceTaskType === delayedTaskType) {
    duplicateTaskFamily = true;
    reasons.push("duplicate_task_family");
  }

  if (!sourcePrompt || !delayedPrompt) {
    reasons.push("missing_prompt_context");
  } else {
    similarity = round(promptSimilarity(sourcePrompt, delayedPrompt));
    if (similarity >= threshold) {
      duplicatePromptFormulation = true;
      reasons.push("duplicate_prompt_formulation");
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
    duplicateTaskFamily,
    duplicatePromptFormulation,
    promptSimilarity: similarity,
  };
}

export async function findPendingDelayedSelfRepairCycle(
  studentId: string
): Promise<PendingDelayedSelfRepairCycle | null> {
  const cycle = await prisma.selfRepairCycle.findFirst({
    where: {
      studentId,
      status: "pending_delayed_verification",
      delayedVerificationTaskInstanceId: null,
      delayedVerificationAttemptId: null,
      immediateAttemptId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sourceAttemptId: true,
      causeLabel: true,
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
    },
  });

  if (!cycle?.sourceAttempt?.task) return null;

  const metadata = asRecord(cycle.metadataJson);
  const sourceTaskType = asString(metadata.sourceTaskType) || cycle.sourceAttempt.task.type;
  const sourcePrompt = asString(metadata.sourcePrompt) || cycle.sourceAttempt.task.prompt;
  if (!sourceTaskType || !sourcePrompt) return null;

  return {
    cycleId: cycle.id,
    sourceAttemptId: cycle.sourceAttemptId,
    sourceTaskType,
    sourcePrompt,
    sourceTaskInstanceId: asString(metadata.sourceTaskInstanceId),
    sourceTargetNodeIds: asStringArray(metadata.sourceTargetNodeIds),
    verificationTaskType: selectDelayedVerificationTaskType(sourceTaskType),
    causeLabel: cycle.causeLabel,
  };
}

export async function attachDelayedVerificationTaskInstance(params: {
  cycleId: string;
  studentId: string;
  taskInstanceId: string;
  taskType: string;
  taskPrompt: string;
  now?: Date;
}) {
  const cycle = await prisma.selfRepairCycle.findUnique({
    where: { id: params.cycleId },
    select: {
      id: true,
      studentId: true,
      status: true,
      delayedVerificationTaskInstanceId: true,
      metadataJson: true,
    },
  });

  if (!cycle || cycle.studentId !== params.studentId) return false;
  if (cycle.status !== "pending_delayed_verification") return false;
  if (cycle.delayedVerificationTaskInstanceId) return true;

  const now = params.now || new Date();
  const existingMetadata = asRecord(cycle.metadataJson);

  await prisma.selfRepairCycle.update({
    where: { id: cycle.id },
    data: {
      delayedVerificationTaskInstanceId: params.taskInstanceId,
      metadataJson: {
        ...existingMetadata,
        delayedVerificationScheduledAt: now.toISOString(),
        delayedVerificationTaskType: params.taskType,
        delayedVerificationPrompt: params.taskPrompt,
        delayedVerificationProtocolVersion: SELF_REPAIR_DELAYED_VERIFICATION_VERSION,
      } as Prisma.InputJsonValue,
    },
  });

  return true;
}

export async function completeDelayedVerificationCycle(params: {
  attemptId: string;
  studentId: string;
  taskMeta: Record<string, unknown>;
  taskType: string;
  taskPrompt: string;
  now?: Date;
}): Promise<{ cycleId: string; status: string; validation: DelayedVerificationValidation } | null> {
  const selfRepair = asRecord(params.taskMeta.selfRepair);
  if (asString(selfRepair.mode) !== "delayed_verification") return null;

  const cycleId = asString(selfRepair.cycleId);
  if (!cycleId) return null;

  const cycle = await prisma.selfRepairCycle.findUnique({
    where: { id: cycleId },
    select: {
      id: true,
      studentId: true,
      status: true,
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
    },
  });

  if (!cycle || cycle.studentId !== params.studentId) return null;
  if (cycle.status !== "pending_delayed_verification") {
    const metadata = asRecord(cycle.metadataJson);
    const priorValidation = asRecord(metadata.delayedVerificationValidation);
    return {
      cycleId: cycle.id,
      status: cycle.status,
      validation: {
        valid: Boolean(priorValidation.valid),
        reasons: asStringArray(priorValidation.reasons),
        duplicateTaskFamily: Boolean(priorValidation.duplicateTaskFamily),
        duplicatePromptFormulation: Boolean(priorValidation.duplicatePromptFormulation),
        promptSimilarity:
          typeof priorValidation.promptSimilarity === "number" &&
          Number.isFinite(priorValidation.promptSimilarity)
            ? round(priorValidation.promptSimilarity)
            : null,
      },
    };
  }

  const existingMetadata = asRecord(cycle.metadataJson);
  const sourceTaskType =
    asString(selfRepair.sourceTaskType) ||
    asString(existingMetadata.sourceTaskType) ||
    cycle.sourceAttempt?.task?.type ||
    null;
  const sourcePrompt =
    asString(selfRepair.sourcePrompt) ||
    asString(existingMetadata.sourcePrompt) ||
    cycle.sourceAttempt?.task?.prompt ||
    null;

  const validation = validateDelayedVerificationNonDuplicate({
    sourceTaskType,
    delayedTaskType: params.taskType,
    sourcePrompt,
    delayedPrompt: params.taskPrompt,
  });

  const now = params.now || new Date();
  const updated = await prisma.selfRepairCycle.update({
    where: { id: cycle.id },
    data: {
      delayedVerificationAttemptId: params.attemptId,
      status: validation.valid ? "completed" : "escalated",
      metadataJson: {
        ...existingMetadata,
        delayedVerificationCompletedAt: now.toISOString(),
        delayedVerificationAttemptId: params.attemptId,
        delayedVerificationTaskType: params.taskType,
        delayedVerificationPrompt: params.taskPrompt,
        delayedVerificationValidation: {
          ...validation,
          protocolVersion: SELF_REPAIR_DELAYED_VERIFICATION_VERSION,
        },
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
    validation,
  };
}

export const __internal = {
  normalizePromptText,
  promptSimilarity,
};
