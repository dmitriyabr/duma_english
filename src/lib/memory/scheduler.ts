import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TRANSFER_REMEDIATION_QUEUE_TYPE } from "@/lib/ood/transferRemediationQueue";

export const MEMORY_SCHEDULER_VERSION = "memory-scheduler-v1" as const;
export const MEMORY_FRESH_QUEUE_TYPE = "memory_fresh" as const;
export const MEMORY_REVIEW_QUEUE_TYPE = "memory_review" as const;
export const MEMORY_SCHEDULER_QUEUE_TYPES = [
  MEMORY_FRESH_QUEUE_TYPE,
  MEMORY_REVIEW_QUEUE_TYPE,
] as const;

const OPEN_QUEUE_STATUSES = ["pending", "scheduled"] as const;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type MemorySchedulerQueueType = (typeof MEMORY_SCHEDULER_QUEUE_TYPES)[number];

type MasteryRow = {
  nodeId: string;
  nodeType: string;
  activationState: string;
  evidenceCount: number;
  directEvidenceCount: number;
  negativeEvidenceCount: number;
  decayedMastery: number;
  uncertainty: number;
  halfLifeDays: number;
  verificationDueAt: Date | null;
  lastEvidenceAt: Date;
};

type MemoryQueuePlan = {
  queueType: MemorySchedulerQueueType;
  reasonCode: string;
  dueAt: Date;
  priority: number;
  fragilityScore: number;
  isFragileNode: boolean;
  daysSinceEvidence: number;
  halfLifeDays: number;
  decayedMastery: number;
  uncertainty: number;
};

type ExistingQueueRow = {
  id: string;
  nodeId: string;
  queueType: string;
  reasonCode: string | null;
  priority: number;
  dueAt: Date;
  metadataJson: unknown;
};

export type MemorySchedulerSyncResult = {
  syncedAt: string;
  schedulerVersion: typeof MEMORY_SCHEDULER_VERSION;
  studentId: string;
  scannedNodes: number;
  queuedNodes: number;
  createdCount: number;
  updatedCount: number;
  closedCount: number;
  openCounts: {
    fresh: number;
    review: number;
    transfer: number;
  };
  fragileOpenCount: number;
};

export type MemorySchedulerBulkSyncResult = {
  syncedAt: string;
  schedulerVersion: typeof MEMORY_SCHEDULER_VERSION;
  studentCount: number;
  totals: {
    scannedNodes: number;
    queuedNodes: number;
    createdCount: number;
    updatedCount: number;
    closedCount: number;
    fragileOpenCount: number;
  };
  students: MemorySchedulerSyncResult[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown) {
  return value === true;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function defaultHalfLifeDays(nodeType: string) {
  if (nodeType === "GSE_VOCAB") return 14;
  if (nodeType === "GSE_GRAMMAR") return 21;
  return 10;
}

function daysSince(lastEvidenceAt: Date, now: Date) {
  return Math.max(0, (now.getTime() - lastEvidenceAt.getTime()) / DAY_MS);
}

function normalizeUncertainty(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return clamp(value, 0, 1);
}

function normalizeDecayedMastery(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return clamp(value, 0, 100);
}

function isFreshNode(row: MasteryRow) {
  return row.evidenceCount <= 2 || row.directEvidenceCount <= 1;
}

export function computeFragilityScore(params: {
  decayedMastery: number;
  uncertainty: number;
  evidenceCount: number;
  directEvidenceCount: number;
  negativeEvidenceCount: number;
}) {
  const masteryRisk = (100 - clamp(params.decayedMastery, 0, 100)) / 100;
  const uncertaintyRisk = clamp((params.uncertainty - 0.2) / 0.8, 0, 1);
  const sparseEvidenceRisk = params.evidenceCount <= 1 ? 1 : params.evidenceCount <= 3 ? 0.5 : 0;
  const directEvidenceRisk = params.directEvidenceCount <= 0 ? 1 : params.directEvidenceCount <= 1 ? 0.5 : 0;
  const negativeSkewRisk = clamp(
    (params.negativeEvidenceCount - params.directEvidenceCount) /
      Math.max(1, params.evidenceCount),
    0,
    1,
  );

  const score =
    masteryRisk * 45 +
    uncertaintyRisk * 25 +
    sparseEvidenceRisk * 15 +
    directEvidenceRisk * 10 +
    negativeSkewRisk * 5;

  return Math.round(clamp(score, 0, 100));
}

export function planMemoryQueueItem(row: MasteryRow, now = new Date()): MemoryQueuePlan | null {
  const verificationDueAtTs = row.verificationDueAt?.getTime() ?? null;
  const verificationDue = verificationDueAtTs !== null && verificationDueAtTs <= now.getTime();
  const nodeDaysSinceEvidence = daysSince(row.lastEvidenceAt, now);
  const overdue = nodeDaysSinceEvidence >= row.halfLifeDays;

  const fragilityScore = computeFragilityScore({
    decayedMastery: row.decayedMastery,
    uncertainty: row.uncertainty,
    evidenceCount: row.evidenceCount,
    directEvidenceCount: row.directEvidenceCount,
    negativeEvidenceCount: row.negativeEvidenceCount,
  });
  const isFragileNode = fragilityScore >= 60;
  const decayRiskSoon = isFragileNode && nodeDaysSinceEvidence >= row.halfLifeDays * 0.6;

  let queueType: MemorySchedulerQueueType | null = null;
  let reasonCode: string | null = null;

  if (verificationDue) {
    queueType = MEMORY_REVIEW_QUEUE_TYPE;
    reasonCode = "verification_due";
  } else if (overdue) {
    queueType = MEMORY_REVIEW_QUEUE_TYPE;
    reasonCode = "memory_overdue";
  } else if (decayRiskSoon) {
    queueType = MEMORY_REVIEW_QUEUE_TYPE;
    reasonCode = "fragile_decay_risk";
  } else if (isFreshNode(row)) {
    queueType = MEMORY_FRESH_QUEUE_TYPE;
    reasonCode = "fresh_consolidation";
  }

  if (!queueType || !reasonCode) return null;

  let dueAt: Date;
  if (queueType === MEMORY_REVIEW_QUEUE_TYPE) {
    if (verificationDue && row.verificationDueAt) {
      dueAt = row.verificationDueAt <= now ? now : row.verificationDueAt;
    } else if (overdue) {
      dueAt = now;
    } else {
      dueAt = new Date(now.getTime() + 6 * HOUR_MS);
    }
  } else {
    const dueHours = isFragileNode ? 12 : 24;
    dueAt = new Date(now.getTime() + dueHours * HOUR_MS);
  }

  const overdueDays = overdue ? nodeDaysSinceEvidence - row.halfLifeDays : 0;
  const basePriority = queueType === MEMORY_REVIEW_QUEUE_TYPE ? 55 : 90;
  const fragilityBoost = Math.round(fragilityScore * 0.28);
  const overdueBoost = Math.round(clamp(overdueDays, 0, 8) * 2);
  const verificationBoost = verificationDue ? 15 : 0;
  const priority = Math.round(
    clamp(basePriority - fragilityBoost - overdueBoost - verificationBoost, 5, 200),
  );

  return {
    queueType,
    reasonCode,
    dueAt,
    priority,
    fragilityScore,
    isFragileNode,
    daysSinceEvidence: round(nodeDaysSinceEvidence),
    halfLifeDays: round(row.halfLifeDays),
    decayedMastery: round(row.decayedMastery),
    uncertainty: round(row.uncertainty),
  };
}

function toMasteryRow(
  row: {
    nodeId: string;
    activationState: string;
    evidenceCount: number;
    directEvidenceCount: number;
    negativeEvidenceCount: number;
    decayedMastery: number | null;
    masteryMean: number | null;
    masteryScore: number;
    uncertainty: number | null;
    halfLifeDays: number | null;
    verificationDueAt: Date | null;
    lastEvidenceAt: Date | null;
    updatedAt: Date;
    node: { type: string };
  },
): MasteryRow {
  return {
    nodeId: row.nodeId,
    nodeType: row.node.type,
    activationState: row.activationState,
    evidenceCount: row.evidenceCount,
    directEvidenceCount: row.directEvidenceCount,
    negativeEvidenceCount: row.negativeEvidenceCount,
    decayedMastery: normalizeDecayedMastery(
      row.decayedMastery ?? row.masteryMean ?? row.masteryScore,
    ),
    uncertainty: normalizeUncertainty(row.uncertainty),
    halfLifeDays: row.halfLifeDays ?? defaultHalfLifeDays(row.node.type),
    verificationDueAt: row.verificationDueAt,
    lastEvidenceAt: row.lastEvidenceAt ?? row.updatedAt,
  };
}

function candidateKey(nodeId: string, queueType: MemorySchedulerQueueType) {
  return `${nodeId}:${queueType}`;
}

function readMemorySchedulerMeta(metadataJson: unknown) {
  const metadata = asObject(metadataJson);
  return asObject(metadata.memoryScheduler);
}

function mergeMemorySchedulerMetadata(current: unknown, patch: Record<string, unknown>) {
  return {
    ...asObject(current),
    memoryScheduler: {
      ...readMemorySchedulerMeta(current),
      ...patch,
    },
  };
}

function shouldUpdateOpenItem(plan: MemoryQueuePlan, existing: ExistingQueueRow) {
  if (existing.reasonCode !== plan.reasonCode) return true;
  if (existing.priority !== plan.priority) return true;
  const dueDiff = Math.abs(existing.dueAt.getTime() - plan.dueAt.getTime());
  if (dueDiff >= 60 * 1000) return true;
  const meta = readMemorySchedulerMeta(existing.metadataJson);
  if (meta.fragilityScore !== plan.fragilityScore) return true;
  if (meta.isFragileNode !== plan.isFragileNode) return true;
  return false;
}

async function countTransferOpenQueue(studentId: string) {
  return prisma.reviewQueueItem.count({
    where: {
      studentId,
      queueType: TRANSFER_REMEDIATION_QUEUE_TYPE,
      status: { in: [...OPEN_QUEUE_STATUSES] },
    },
  });
}

export async function syncMemorySchedulerForStudent(params: {
  studentId: string;
  now?: Date;
  maxCandidates?: number;
}): Promise<MemorySchedulerSyncResult> {
  const now = params.now || new Date();
  const maxCandidates = Math.max(10, Math.min(500, Math.floor(params.maxCandidates ?? 120)));

  const masteryRowsRaw = await prisma.studentGseMastery.findMany({
    where: { studentId: params.studentId },
    select: {
      nodeId: true,
      activationState: true,
      evidenceCount: true,
      directEvidenceCount: true,
      negativeEvidenceCount: true,
      decayedMastery: true,
      masteryMean: true,
      masteryScore: true,
      uncertainty: true,
      halfLifeDays: true,
      verificationDueAt: true,
      lastEvidenceAt: true,
      updatedAt: true,
      node: {
        select: {
          type: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 2000,
  });

  const masteryRows = masteryRowsRaw.map(toMasteryRow);

  const planned = masteryRows
    .map((row) => ({ row, plan: planMemoryQueueItem(row, now) }))
    .filter(
      (
        entry,
      ): entry is {
        row: MasteryRow;
        plan: MemoryQueuePlan;
      } => entry.plan !== null,
    )
    .sort((a, b) => {
      if (a.plan.priority !== b.plan.priority) {
        return a.plan.priority - b.plan.priority;
      }
      return a.plan.dueAt.getTime() - b.plan.dueAt.getTime();
    })
    .slice(0, maxCandidates);

  const openItems = await prisma.reviewQueueItem.findMany({
    where: {
      studentId: params.studentId,
      queueType: { in: [...MEMORY_SCHEDULER_QUEUE_TYPES] },
      status: { in: [...OPEN_QUEUE_STATUSES] },
    },
    select: {
      id: true,
      nodeId: true,
      queueType: true,
      reasonCode: true,
      priority: true,
      dueAt: true,
      metadataJson: true,
    },
  });

  const existingByKey = new Map<string, ExistingQueueRow>();
  for (const item of openItems) {
    if (
      item.queueType !== MEMORY_FRESH_QUEUE_TYPE &&
      item.queueType !== MEMORY_REVIEW_QUEUE_TYPE
    ) {
      continue;
    }
    existingByKey.set(candidateKey(item.nodeId, item.queueType), item);
  }

  const touchedKeys = new Set<string>();
  let createdCount = 0;
  let updatedCount = 0;

  for (const entry of planned) {
    const key = candidateKey(entry.row.nodeId, entry.plan.queueType);
    const metadataPatch = {
      protocolVersion: MEMORY_SCHEDULER_VERSION,
      queueType: entry.plan.queueType,
      reasonCode: entry.plan.reasonCode,
      fragilityScore: entry.plan.fragilityScore,
      isFragileNode: entry.plan.isFragileNode,
      daysSinceEvidence: entry.plan.daysSinceEvidence,
      halfLifeDays: entry.plan.halfLifeDays,
      decayedMastery: entry.plan.decayedMastery,
      uncertainty: entry.plan.uncertainty,
      nodeType: entry.row.nodeType,
      activationState: entry.row.activationState,
      scheduledAt: now.toISOString(),
      dueAt: entry.plan.dueAt.toISOString(),
    };

    const existing = existingByKey.get(key);
    if (!existing) {
      await prisma.reviewQueueItem.create({
        data: {
          studentId: params.studentId,
          nodeId: entry.row.nodeId,
          queueType: entry.plan.queueType,
          status: "pending",
          reasonCode: entry.plan.reasonCode,
          priority: entry.plan.priority,
          dueAt: entry.plan.dueAt,
          metadataJson: {
            memoryScheduler: metadataPatch,
          } as Prisma.InputJsonValue,
        },
      });
      createdCount += 1;
    } else if (shouldUpdateOpenItem(entry.plan, existing)) {
      await prisma.reviewQueueItem.update({
        where: { id: existing.id },
        data: {
          reasonCode: entry.plan.reasonCode,
          priority: entry.plan.priority,
          dueAt: entry.plan.dueAt,
          metadataJson: mergeMemorySchedulerMetadata(
            existing.metadataJson,
            metadataPatch,
          ) as Prisma.InputJsonValue,
        },
      });
      updatedCount += 1;
    }

    touchedKeys.add(key);
  }

  const staleItems = openItems.filter((item) => {
    if (
      item.queueType !== MEMORY_FRESH_QUEUE_TYPE &&
      item.queueType !== MEMORY_REVIEW_QUEUE_TYPE
    ) {
      return false;
    }
    const key = candidateKey(item.nodeId, item.queueType);
    return !touchedKeys.has(key);
  });

  for (const stale of staleItems) {
    await prisma.reviewQueueItem.update({
      where: { id: stale.id },
      data: {
        status: "completed",
        completedAt: now,
        reasonCode: "scheduler_not_due",
        metadataJson: mergeMemorySchedulerMetadata(stale.metadataJson, {
          protocolVersion: MEMORY_SCHEDULER_VERSION,
          closedAt: now.toISOString(),
          closureReason: "scheduler_not_due",
        }) as Prisma.InputJsonValue,
      },
    });
  }

  const openMemoryRows = await prisma.reviewQueueItem.findMany({
    where: {
      studentId: params.studentId,
      queueType: { in: [...MEMORY_SCHEDULER_QUEUE_TYPES] },
      status: { in: [...OPEN_QUEUE_STATUSES] },
    },
    select: {
      queueType: true,
      metadataJson: true,
    },
  });

  const openFreshCount = openMemoryRows.filter(
    (row) => row.queueType === MEMORY_FRESH_QUEUE_TYPE,
  ).length;
  const openReviewCount = openMemoryRows.filter(
    (row) => row.queueType === MEMORY_REVIEW_QUEUE_TYPE,
  ).length;
  const fragileOpenCount = openMemoryRows.filter((row) => {
    const schedulerMeta = readMemorySchedulerMeta(row.metadataJson);
    return asBoolean(schedulerMeta.isFragileNode);
  }).length;

  const transferOpenCount = await countTransferOpenQueue(params.studentId);

  return {
    syncedAt: now.toISOString(),
    schedulerVersion: MEMORY_SCHEDULER_VERSION,
    studentId: params.studentId,
    scannedNodes: masteryRows.length,
    queuedNodes: planned.length,
    createdCount,
    updatedCount,
    closedCount: staleItems.length,
    openCounts: {
      fresh: openFreshCount,
      review: openReviewCount,
      transfer: transferOpenCount,
    },
    fragileOpenCount,
  };
}

export async function syncMemorySchedulerForStudents(params?: {
  studentIds?: string[];
  maxStudents?: number;
  maxCandidatesPerStudent?: number;
  now?: Date;
}): Promise<MemorySchedulerBulkSyncResult> {
  const now = params?.now || new Date();
  const maxStudents = Math.max(1, Math.min(5000, Math.floor(params?.maxStudents ?? 200)));

  let studentIds = params?.studentIds?.filter((value) => value.trim().length > 0) || [];
  if (studentIds.length === 0) {
    const studentRows = await prisma.studentGseMastery.findMany({
      distinct: ["studentId"],
      select: { studentId: true },
      orderBy: { updatedAt: "desc" },
      take: maxStudents,
    });
    studentIds = studentRows.map((row) => row.studentId);
  }

  const students: MemorySchedulerSyncResult[] = [];
  for (const studentId of studentIds) {
    const result = await syncMemorySchedulerForStudent({
      studentId,
      now,
      maxCandidates: params?.maxCandidatesPerStudent,
    });
    students.push(result);
  }

  const totals = students.reduce(
    (acc, row) => {
      acc.scannedNodes += row.scannedNodes;
      acc.queuedNodes += row.queuedNodes;
      acc.createdCount += row.createdCount;
      acc.updatedCount += row.updatedCount;
      acc.closedCount += row.closedCount;
      acc.fragileOpenCount += row.fragileOpenCount;
      return acc;
    },
    {
      scannedNodes: 0,
      queuedNodes: 0,
      createdCount: 0,
      updatedCount: 0,
      closedCount: 0,
      fragileOpenCount: 0,
    },
  );

  return {
    syncedAt: now.toISOString(),
    schedulerVersion: MEMORY_SCHEDULER_VERSION,
    studentCount: students.length,
    totals,
    students,
  };
}

export const __internal = {
  defaultHalfLifeDays,
  isFreshNode,
  planMemoryQueueItem,
  candidateKey,
  mergeMemorySchedulerMetadata,
  median,
};
