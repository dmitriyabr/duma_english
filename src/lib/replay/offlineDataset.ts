import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

export const OFFLINE_REPLAY_DATASET_VERSION = "offline-replay-dataset-v1";
export const OFFLINE_REPLAY_REQUIRED_EVENT_TYPES = [
  "planner_decision_created",
  "task_instance_created",
  "attempt_created",
  "delayed_outcome_recorded",
] as const;

const EVENT_TYPE_SET = new Set<string>(OFFLINE_REPLAY_REQUIRED_EVENT_TYPES);

export type OfflineReplayEventType = (typeof OFFLINE_REPLAY_REQUIRED_EVENT_TYPES)[number];

export type OfflineReplayEventRow = {
  id: string;
  eventType: string;
  createdAt: Date;
  studentId: string | null;
  decisionLogId: string | null;
  taskInstanceId: string | null;
  taskId: string | null;
  attemptId: string | null;
  delayedOutcomeId: string | null;
  payloadJson: unknown;
};

export type OfflineReplayDelayedOutcomeRow = {
  id: string;
  status: string;
  outcomeWindow: string;
  outcomeJson: unknown;
  createdAt: Date;
};

export type OfflineReplayDatasetRow = {
  sampleId: string;
  decisionLogId: string;
  studentId: string | null;
  linkage: {
    taskInstanceId: string | null;
    taskId: string | null;
    attemptId: string | null;
    delayedOutcomeId: string | null;
  };
  timestamps: {
    decisionTs: string | null;
    taskInstanceTs: string | null;
    attemptTs: string | null;
    delayedOutcomeTs: string | null;
  };
  context: {
    chosenTaskType: string | null;
    targetNodeIds: string[];
    selectionReason: string | null;
    primaryGoal: string | null;
    ambiguityTriggerApplied: boolean | null;
    causalRemediationApplied: boolean | null;
    causalRemediationTopCause: string | null;
    causalRemediationChosenAdjustment: number | null;
  };
  action: {
    taskType: string | null;
    targetNodeIds: string[];
    fallbackUsed: boolean | null;
    estimatedDifficulty: number | null;
    attemptStatus: string | null;
    durationSec: number | null;
    contentType: string | null;
  };
  delayedOutcome: {
    outcomeWindow: string | null;
    status: string | null;
    evidenceCount: number | null;
    nodeOutcomeCount: number | null;
    masteryDeltaTotal: number | null;
    payload: Record<string, unknown>;
  };
  completeness: {
    hasDecisionEvent: boolean;
    hasTaskInstanceEvent: boolean;
    hasAttemptEvent: boolean;
    hasDelayedOutcomeEvent: boolean;
    hasOutcomePayload: boolean;
    hasLinkageIds: boolean;
    missing: string[];
    isComplete: boolean;
  };
};

export type OfflineReplayCompletenessSummary = {
  completeRows: number;
  incompleteRows: number;
  completenessRate: number;
  missingDecisionEvent: number;
  missingTaskInstanceEvent: number;
  missingAttemptEvent: number;
  missingDelayedOutcomeEvent: number;
  missingOutcomePayload: number;
  missingLinkage: number;
};

export type OfflineReplayDataset = {
  generatedAt: string;
  datasetVersion: typeof OFFLINE_REPLAY_DATASET_VERSION;
  windowDays: number;
  sourceWindowStart: string | null;
  sourceWindowEnd: string | null;
  totalEvents: number;
  totalDecisionGroups: number;
  eventTypeCounts: Record<string, number>;
  completeness: OfflineReplayCompletenessSummary;
  rows: OfflineReplayDatasetRow[];
};

type EventGroup = {
  decisionLogId: string;
  decisionEvent: OfflineReplayEventRow | null;
  taskInstanceEvent: OfflineReplayEventRow | null;
  attemptEvent: OfflineReplayEventRow | null;
  delayedOutcomeEvent: OfflineReplayEventRow | null;
};

function compareEventsAsc(a: Pick<OfflineReplayEventRow, "createdAt" | "id">, b: Pick<OfflineReplayEventRow, "createdAt" | "id">) {
  const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.id.localeCompare(b.id);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((item): item is string => Boolean(item));
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function chooseFirst<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && typeof value !== "undefined") {
      return value;
    }
  }
  return null;
}

function isoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function summarizeCompleteness(rows: OfflineReplayDatasetRow[]): OfflineReplayCompletenessSummary {
  let completeRows = 0;
  let missingDecisionEvent = 0;
  let missingTaskInstanceEvent = 0;
  let missingAttemptEvent = 0;
  let missingDelayedOutcomeEvent = 0;
  let missingOutcomePayload = 0;
  let missingLinkage = 0;

  for (const row of rows) {
    if (row.completeness.isComplete) {
      completeRows += 1;
    }
    if (!row.completeness.hasDecisionEvent) missingDecisionEvent += 1;
    if (!row.completeness.hasTaskInstanceEvent) missingTaskInstanceEvent += 1;
    if (!row.completeness.hasAttemptEvent) missingAttemptEvent += 1;
    if (!row.completeness.hasDelayedOutcomeEvent) missingDelayedOutcomeEvent += 1;
    if (!row.completeness.hasOutcomePayload) missingOutcomePayload += 1;
    if (!row.completeness.hasLinkageIds) missingLinkage += 1;
  }

  const incompleteRows = Math.max(0, rows.length - completeRows);
  return {
    completeRows,
    incompleteRows,
    completenessRate: rows.length > 0 ? Number((completeRows / rows.length).toFixed(6)) : 0,
    missingDecisionEvent,
    missingTaskInstanceEvent,
    missingAttemptEvent,
    missingDelayedOutcomeEvent,
    missingOutcomePayload,
    missingLinkage,
  };
}

function groupEventsByDecision(events: OfflineReplayEventRow[]): Map<string, EventGroup> {
  const groups = new Map<string, EventGroup>();

  for (const event of [...events].sort(compareEventsAsc)) {
    if (!EVENT_TYPE_SET.has(event.eventType)) continue;
    const decisionLogId = asString(event.decisionLogId);
    if (!decisionLogId) continue;

    if (!groups.has(decisionLogId)) {
      groups.set(decisionLogId, {
        decisionLogId,
        decisionEvent: null,
        taskInstanceEvent: null,
        attemptEvent: null,
        delayedOutcomeEvent: null,
      });
    }
    const group = groups.get(decisionLogId)!;

    if (event.eventType === "planner_decision_created") {
      if (!group.decisionEvent) {
        group.decisionEvent = event;
      }
      continue;
    }
    if (event.eventType === "task_instance_created") {
      if (!group.taskInstanceEvent) {
        group.taskInstanceEvent = event;
      }
      continue;
    }
    if (event.eventType === "attempt_created") {
      if (!group.attemptEvent) {
        group.attemptEvent = event;
      }
      continue;
    }
    if (event.eventType === "delayed_outcome_recorded") {
      // Keep the latest delayed-outcome event if multiple are present.
      group.delayedOutcomeEvent = event;
    }
  }

  return groups;
}

function buildDatasetRow(group: EventGroup, delayedOutcomeById: Map<string, OfflineReplayDelayedOutcomeRow>) {
  const decisionPayload = asObject(group.decisionEvent?.payloadJson);
  const taskPayload = asObject(group.taskInstanceEvent?.payloadJson);
  const attemptPayload = asObject(group.attemptEvent?.payloadJson);
  const delayedOutcomeEventPayload = asObject(group.delayedOutcomeEvent?.payloadJson);

  const delayedOutcomeId = chooseFirst(
    asString(group.delayedOutcomeEvent?.delayedOutcomeId),
    asString(group.attemptEvent?.delayedOutcomeId),
    asString(group.taskInstanceEvent?.delayedOutcomeId),
    asString(group.decisionEvent?.delayedOutcomeId)
  );
  const delayedOutcomeRow = delayedOutcomeId ? delayedOutcomeById.get(delayedOutcomeId) ?? null : null;
  const delayedOutcomePayload = {
    ...asObject(delayedOutcomeRow?.outcomeJson),
    ...delayedOutcomeEventPayload,
  };

  const studentId = chooseFirst(
    asString(group.decisionEvent?.studentId),
    asString(group.taskInstanceEvent?.studentId),
    asString(group.attemptEvent?.studentId),
    asString(group.delayedOutcomeEvent?.studentId)
  );

  const linkageTaskInstanceId = chooseFirst(
    asString(group.taskInstanceEvent?.taskInstanceId),
    asString(group.attemptEvent?.taskInstanceId),
    asString(group.delayedOutcomeEvent?.taskInstanceId),
    asString(group.decisionEvent?.taskInstanceId)
  );
  const linkageTaskId = chooseFirst(
    asString(group.taskInstanceEvent?.taskId),
    asString(group.attemptEvent?.taskId),
    asString(group.delayedOutcomeEvent?.taskId),
    asString(group.decisionEvent?.taskId)
  );
  const linkageAttemptId = chooseFirst(
    asString(group.attemptEvent?.attemptId),
    asString(group.delayedOutcomeEvent?.attemptId),
    asString(group.taskInstanceEvent?.attemptId),
    asString(group.decisionEvent?.attemptId)
  );

  const hasDecisionEvent = Boolean(group.decisionEvent);
  const hasTaskInstanceEvent = Boolean(group.taskInstanceEvent);
  const hasAttemptEvent = Boolean(group.attemptEvent);
  const hasDelayedOutcomeEvent = Boolean(group.delayedOutcomeEvent);
  const hasOutcomePayload = Object.keys(delayedOutcomePayload).length > 0;
  const hasLinkageIds = Boolean(studentId && linkageTaskId && linkageAttemptId);

  const missing: string[] = [];
  if (!hasDecisionEvent) missing.push("decision_event");
  if (!hasTaskInstanceEvent) missing.push("task_instance_event");
  if (!hasAttemptEvent) missing.push("attempt_event");
  if (!hasDelayedOutcomeEvent) missing.push("delayed_outcome_event");
  if (!hasOutcomePayload) missing.push("delayed_outcome_payload");
  if (!hasLinkageIds) missing.push("linkage_ids");

  return {
    sampleId: group.decisionLogId,
    decisionLogId: group.decisionLogId,
    studentId,
    linkage: {
      taskInstanceId: linkageTaskInstanceId,
      taskId: linkageTaskId,
      attemptId: linkageAttemptId,
      delayedOutcomeId,
    },
    timestamps: {
      decisionTs: isoOrNull(group.decisionEvent?.createdAt),
      taskInstanceTs: isoOrNull(group.taskInstanceEvent?.createdAt),
      attemptTs: isoOrNull(group.attemptEvent?.createdAt),
      delayedOutcomeTs: isoOrNull(group.delayedOutcomeEvent?.createdAt),
    },
    context: {
      chosenTaskType: asString(decisionPayload.chosenTaskType),
      targetNodeIds: asStringArray(decisionPayload.targetNodeIds),
      selectionReason: asString(decisionPayload.selectionReason),
      primaryGoal: asString(decisionPayload.primaryGoal),
      ambiguityTriggerApplied: asBoolean(decisionPayload.ambiguityTriggerApplied),
      causalRemediationApplied: asBoolean(decisionPayload.causalRemediationApplied),
      causalRemediationTopCause: asString(decisionPayload.causalRemediationTopCause),
      causalRemediationChosenAdjustment: asNumber(decisionPayload.causalRemediationChosenAdjustment),
    },
    action: {
      taskType: asString(taskPayload.taskType),
      targetNodeIds: asStringArray(taskPayload.targetNodeIds),
      fallbackUsed: asBoolean(taskPayload.fallbackUsed),
      estimatedDifficulty: asNumber(taskPayload.estimatedDifficulty),
      attemptStatus: asString(attemptPayload.status),
      durationSec: asNumber(attemptPayload.durationSec),
      contentType: asString(attemptPayload.contentType),
    },
    delayedOutcome: {
      outcomeWindow: chooseFirst(asString(delayedOutcomeEventPayload.outcomeWindow), delayedOutcomeRow?.outcomeWindow ?? null),
      status: chooseFirst(asString(delayedOutcomeEventPayload.status), delayedOutcomeRow?.status ?? null),
      evidenceCount: chooseFirst(asNumber(delayedOutcomeEventPayload.evidenceCount), asNumber(delayedOutcomePayload.evidenceCount)),
      nodeOutcomeCount: chooseFirst(asNumber(delayedOutcomeEventPayload.nodeOutcomeCount), asNumber(delayedOutcomePayload.nodeOutcomeCount)),
      masteryDeltaTotal: chooseFirst(
        asNumber(delayedOutcomeEventPayload.masteryDeltaTotal),
        asNumber(delayedOutcomePayload.masteryDeltaTotal)
      ),
      payload: delayedOutcomePayload,
    },
    completeness: {
      hasDecisionEvent,
      hasTaskInstanceEvent,
      hasAttemptEvent,
      hasDelayedOutcomeEvent,
      hasOutcomePayload,
      hasLinkageIds,
      missing,
      isComplete: missing.length === 0,
    },
  } satisfies OfflineReplayDatasetRow;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function buildOfflineReplayDatasetFromRows(params: {
  eventRows: OfflineReplayEventRow[];
  delayedOutcomeRows?: OfflineReplayDelayedOutcomeRow[];
  windowDays: number;
  now?: Date;
}): OfflineReplayDataset {
  const eventRows = [...params.eventRows].sort(compareEventsAsc);
  const delayedOutcomeRows = params.delayedOutcomeRows || [];
  const delayedOutcomeById = new Map(delayedOutcomeRows.map((row) => [row.id, row]));

  const groups = groupEventsByDecision(eventRows);
  const rows = [...groups.values()]
    .map((group) => buildDatasetRow(group, delayedOutcomeById))
    .sort((a, b) => {
      const aTs = a.timestamps.decisionTs || a.timestamps.delayedOutcomeTs || "";
      const bTs = b.timestamps.decisionTs || b.timestamps.delayedOutcomeTs || "";
      const byTs = bTs.localeCompare(aTs);
      if (byTs !== 0) return byTs;
      return a.decisionLogId.localeCompare(b.decisionLogId);
    });

  const eventTypeCounts = eventRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.eventType] = (acc[row.eventType] || 0) + 1;
    return acc;
  }, {});

  const completeness = summarizeCompleteness(rows);
  const sourceWindowStart = eventRows.length > 0 ? eventRows[0].createdAt.toISOString() : null;
  const sourceWindowEnd = eventRows.length > 0 ? eventRows[eventRows.length - 1].createdAt.toISOString() : null;

  return {
    generatedAt: (params.now || new Date()).toISOString(),
    datasetVersion: OFFLINE_REPLAY_DATASET_VERSION,
    windowDays: clamp(params.windowDays, 1, 365),
    sourceWindowStart,
    sourceWindowEnd,
    totalEvents: eventRows.length,
    totalDecisionGroups: rows.length,
    eventTypeCounts,
    completeness,
    rows,
  };
}

export async function buildOfflineReplayDataset(params?: {
  windowDays?: number;
  eventLimit?: number;
  decisionLimit?: number;
}): Promise<OfflineReplayDataset> {
  const windowDays = clamp(params?.windowDays ?? 30, 1, 365);
  const eventLimit = clamp(params?.eventLimit ?? 50000, 500, 200000);
  const decisionLimit = clamp(params?.decisionLimit ?? 5000, 100, 50000);

  const since = new Date(Date.now() - windowDays * DAY_MS);
  const rawEventRows = await prisma.autopilotEventLog.findMany({
    where: {
      createdAt: { gte: since },
      decisionLogId: { not: null },
      eventType: { in: [...OFFLINE_REPLAY_REQUIRED_EVENT_TYPES] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: eventLimit,
    select: {
      id: true,
      eventType: true,
      createdAt: true,
      studentId: true,
      decisionLogId: true,
      taskInstanceId: true,
      taskId: true,
      attemptId: true,
      delayedOutcomeId: true,
      payloadJson: true,
    },
  });

  const recentDecisionIds: string[] = [];
  const recentDecisionSet = new Set<string>();
  for (const row of rawEventRows) {
    const decisionId = asString(row.decisionLogId);
    if (!decisionId || recentDecisionSet.has(decisionId)) continue;
    recentDecisionSet.add(decisionId);
    recentDecisionIds.push(decisionId);
    if (recentDecisionIds.length >= decisionLimit) break;
  }

  const selectedDecisionSet = new Set(recentDecisionIds);
  const eventRows: OfflineReplayEventRow[] = rawEventRows
    .filter((row) => {
      const decisionId = asString(row.decisionLogId);
      return Boolean(decisionId && selectedDecisionSet.has(decisionId));
    })
    .map((row) => ({
      id: row.id,
      eventType: row.eventType,
      createdAt: row.createdAt,
      studentId: row.studentId,
      decisionLogId: row.decisionLogId,
      taskInstanceId: row.taskInstanceId,
      taskId: row.taskId,
      attemptId: row.attemptId,
      delayedOutcomeId: row.delayedOutcomeId,
      payloadJson: row.payloadJson,
    }));

  const delayedOutcomeIds = [...new Set(eventRows.map((row) => asString(row.delayedOutcomeId)).filter((id): id is string => Boolean(id)))];
  const delayedOutcomeRows = delayedOutcomeIds.length
    ? await prisma.autopilotDelayedOutcome.findMany({
        where: { id: { in: delayedOutcomeIds } },
        select: {
          id: true,
          status: true,
          outcomeWindow: true,
          outcomeJson: true,
          createdAt: true,
        },
      })
    : [];

  return buildOfflineReplayDatasetFromRows({
    eventRows,
    delayedOutcomeRows,
    windowDays,
  });
}

export function serializeOfflineReplayDatasetRows(rows: OfflineReplayDatasetRow[], format: "json" | "ndjson") {
  if (format === "json") {
    return JSON.stringify(rows, null, 2);
  }
  return rows.map((row) => JSON.stringify(row)).join("\n");
}
