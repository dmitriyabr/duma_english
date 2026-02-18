import { prisma } from "@/lib/db";

export const SELF_REPAIR_BUDGET_GUARDRAILS_VERSION = "self-repair-budget-guardrails-v1" as const;
export const SELF_REPAIR_ESCALATION_QUEUE_TYPE = "self_repair_escalation";
export const SELF_REPAIR_SESSION_WINDOW_MINUTES = 90;
export const SELF_REPAIR_MAX_LOOPS_PER_SKILL_SESSION = 2;
export const SELF_REPAIR_MAX_SESSION_TIME_SHARE = 0.25;
export const SELF_REPAIR_ESTIMATED_IMMEDIATE_DURATION_SEC = 90;

export type SelfRepairBudgetUsage = {
  version: typeof SELF_REPAIR_BUDGET_GUARDRAILS_VERSION;
  windowMinutes: number;
  loopsUsedForSkillSession: number;
  maxLoopsPerSkillSession: number;
  sessionTotalDurationSec: number;
  immediateDurationSec: number;
  projectedImmediateDurationSec: number;
  projectedSessionDurationSec: number;
  projectedImmediateShare: number;
  maxSessionTimeShare: number;
  exhausted: boolean;
  reasons: string[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function evaluateSelfRepairBudgetFromStats(params: {
  loopsUsedForSkillSession: number;
  sessionTotalDurationSec: number;
  immediateDurationSec: number;
  estimatedImmediateDurationSec: number;
}): SelfRepairBudgetUsage {
  const loopsUsedForSkillSession = Math.max(0, Math.floor(params.loopsUsedForSkillSession));
  const sessionTotalDurationSec = Math.max(0, params.sessionTotalDurationSec);
  const immediateDurationSec = Math.max(0, params.immediateDurationSec);
  const estimatedImmediateDurationSec = Math.max(0, params.estimatedImmediateDurationSec);

  const projectedImmediateDurationSec = immediateDurationSec + estimatedImmediateDurationSec;
  const projectedSessionDurationSec = sessionTotalDurationSec + estimatedImmediateDurationSec;
  const projectedImmediateShare =
    projectedSessionDurationSec > 0
      ? projectedImmediateDurationSec / projectedSessionDurationSec
      : 0;

  const reasons: string[] = [];
  if (loopsUsedForSkillSession >= SELF_REPAIR_MAX_LOOPS_PER_SKILL_SESSION) {
    reasons.push("per_skill_loop_cap");
  }
  if (projectedImmediateShare > SELF_REPAIR_MAX_SESSION_TIME_SHARE) {
    reasons.push("session_time_share_cap");
  }

  return {
    version: SELF_REPAIR_BUDGET_GUARDRAILS_VERSION,
    windowMinutes: SELF_REPAIR_SESSION_WINDOW_MINUTES,
    loopsUsedForSkillSession,
    maxLoopsPerSkillSession: SELF_REPAIR_MAX_LOOPS_PER_SKILL_SESSION,
    sessionTotalDurationSec: round(sessionTotalDurationSec, 2),
    immediateDurationSec: round(immediateDurationSec, 2),
    projectedImmediateDurationSec: round(projectedImmediateDurationSec, 2),
    projectedSessionDurationSec: round(projectedSessionDurationSec, 2),
    projectedImmediateShare: round(clamp(projectedImmediateShare, 0, 1), 6),
    maxSessionTimeShare: SELF_REPAIR_MAX_SESSION_TIME_SHARE,
    exhausted: reasons.length > 0,
    reasons,
  };
}

export async function computeSelfRepairBudgetUsage(params: {
  studentId: string;
  sourceTaskType: string;
  sourceAttemptId: string;
  now?: Date;
}): Promise<SelfRepairBudgetUsage> {
  const now = params.now || new Date();
  const since = new Date(now.getTime() - SELF_REPAIR_SESSION_WINDOW_MINUTES * 60 * 1000);

  const [recentCycles, recentAttempts, sourceAttempt] = await Promise.all([
    prisma.selfRepairCycle.findMany({
      where: {
        studentId: params.studentId,
        createdAt: { gte: since },
      },
      select: {
        status: true,
        metadataJson: true,
        sourceAttempt: {
          select: {
            task: {
              select: { type: true },
            },
          },
        },
      },
    }),
    prisma.attempt.findMany({
      where: {
        studentId: params.studentId,
        createdAt: { gte: since },
      },
      select: {
        durationSec: true,
        task: {
          select: {
            metaJson: true,
          },
        },
      },
    }),
    prisma.attempt.findUnique({
      where: { id: params.sourceAttemptId },
      select: {
        durationSec: true,
      },
    }),
  ]);

  const loopsUsedForSkillSession = recentCycles.filter((cycle) => {
    if (cycle.status === "cancelled") return false;
    const sourceTaskType =
      cycle.sourceAttempt?.task?.type || asString(asObject(cycle.metadataJson).sourceTaskType);
    return sourceTaskType === params.sourceTaskType;
  }).length;

  const sessionTotalDurationSec = recentAttempts.reduce((sum, row) => {
    const duration = asNumber(row.durationSec);
    return sum + (duration ?? 0);
  }, 0);

  const immediateDurationSec = recentAttempts.reduce((sum, row) => {
    const duration = asNumber(row.durationSec);
    if (duration === null) return sum;
    const taskMeta = asObject(row.task?.metaJson);
    const selfRepair = asObject(taskMeta.selfRepair);
    return selfRepair.mode === "immediate_retry" ? sum + duration : sum;
  }, 0);

  const estimatedImmediateDurationSec =
    asNumber(sourceAttempt?.durationSec) ?? SELF_REPAIR_ESTIMATED_IMMEDIATE_DURATION_SEC;

  return evaluateSelfRepairBudgetFromStats({
    loopsUsedForSkillSession,
    sessionTotalDurationSec,
    immediateDurationSec,
    estimatedImmediateDurationSec,
  });
}
