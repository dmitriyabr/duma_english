import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AutopilotEventType =
  | "planner_decision_created"
  | "task_instance_created"
  | "attempt_created"
  | "evidence_written"
  | "delayed_outcome_recorded"
  | "custom";

export type AutopilotEventInput = {
  eventType: AutopilotEventType | (string & {});
  studentId?: string | null;
  decisionLogId?: string | null;
  taskInstanceId?: string | null;
  taskId?: string | null;
  attemptId?: string | null;
  evidenceId?: string | null;
  delayedOutcomeId?: string | null;
  payload?: Prisma.InputJsonValue;
};

export type AutopilotDelayedOutcomeInput = {
  studentId: string;
  decisionLogId?: string | null;
  taskInstanceId?: string | null;
  taskId?: string | null;
  attemptId?: string | null;
  outcomeWindow?: string;
  status?: string;
  outcome?: Prisma.InputJsonValue;
};

function normalizeOptionalId(value?: string | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toEventCreateData(input: AutopilotEventInput): Prisma.AutopilotEventLogCreateManyInput | null {
  const eventType = normalizeOptionalId(input.eventType);
  if (!eventType) return null;
  return {
    eventType,
    studentId: normalizeOptionalId(input.studentId),
    decisionLogId: normalizeOptionalId(input.decisionLogId),
    taskInstanceId: normalizeOptionalId(input.taskInstanceId),
    taskId: normalizeOptionalId(input.taskId),
    attemptId: normalizeOptionalId(input.attemptId),
    evidenceId: normalizeOptionalId(input.evidenceId),
    delayedOutcomeId: normalizeOptionalId(input.delayedOutcomeId),
    payloadJson: typeof input.payload === "undefined" ? Prisma.JsonNull : input.payload,
  };
}

/**
 * Best-effort append-only event writer.
 * Failures are logged and should not break learner runtime.
 */
export async function appendAutopilotEvents(inputs: AutopilotEventInput[]) {
  if (!Array.isArray(inputs) || inputs.length === 0) return;
  const rows = inputs
    .map((input) => toEventCreateData(input))
    .filter((row): row is Prisma.AutopilotEventLogCreateManyInput => Boolean(row));
  if (rows.length === 0) return;

  try {
    await prisma.autopilotEventLog.createMany({ data: rows });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "autopilot_event_log_write_failed",
        error: error instanceof Error ? error.message : String(error),
        rows: rows.length,
      })
    );
  }
}

export async function appendAutopilotEvent(input: AutopilotEventInput) {
  await appendAutopilotEvents([input]);
}

export async function recordAutopilotDelayedOutcome(
  input: AutopilotDelayedOutcomeInput
): Promise<{ id: string } | null> {
  const studentId = normalizeOptionalId(input.studentId);
  if (!studentId) return null;

  try {
    const row = await prisma.autopilotDelayedOutcome.create({
      data: {
        studentId,
        decisionLogId: normalizeOptionalId(input.decisionLogId),
        taskInstanceId: normalizeOptionalId(input.taskInstanceId),
        taskId: normalizeOptionalId(input.taskId),
        attemptId: normalizeOptionalId(input.attemptId),
        outcomeWindow: normalizeOptionalId(input.outcomeWindow) || "same_session",
        status: normalizeOptionalId(input.status) || "recorded",
        outcomeJson: typeof input.outcome === "undefined" ? Prisma.JsonNull : input.outcome,
      },
      select: { id: true },
    });
    return row;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "autopilot_delayed_outcome_write_failed",
        error: error instanceof Error ? error.message : String(error),
        studentId,
        decisionLogId: normalizeOptionalId(input.decisionLogId),
        taskId: normalizeOptionalId(input.taskId),
        attemptId: normalizeOptionalId(input.attemptId),
      })
    );
    return null;
  }
}
