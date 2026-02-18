import type { CEFRStage } from "@/lib/curriculum";
import { prisma } from "@/lib/db";
import {
  retentionCohortReportSchema,
  type RetentionCohortReport,
  RETENTION_COHORT_CONTRACT_VERSION,
} from "@/lib/contracts/retentionCohortReport";
import {
  RETENTION_PROBE_GRACE_DAYS,
  RETENTION_PROBE_PROTOCOL_VERSION,
  RETENTION_PROBE_WINDOWS,
  buildRetentionProbes,
  mapRetentionDomain,
  mapRetentionStage,
  type RetentionDomain,
  type RetentionEvidenceObservation,
  type RetentionProbe,
  type RetentionWindowDays,
} from "@/lib/retention/probes";

const DAY_MS = 24 * 60 * 60 * 1000;
const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
const DOMAIN_ORDER: RetentionDomain[] = ["vocab", "grammar", "communication", "other"];
const MAX_PROBE_WINDOW_DAYS = Math.max(...RETENTION_PROBE_WINDOWS);

type EvidenceQueryRow = {
  studentId: string;
  nodeId: string;
  createdAt: Date;
  score: number;
  domain: string | null;
  node: {
    gseCenter: number | null;
    type: string;
    skill: string | null;
  };
};

type CohortAccumulator = {
  windowDays: RetentionWindowDays;
  stage: CEFRStage;
  domain: RetentionDomain;
  dueProbeCount: number;
  pendingProbeCount: number;
  evaluatedProbeCount: number;
  passedCount: number;
  failedCount: number;
  missedFollowUpCount: number;
  lagValuesDays: number[];
  students: Set<string>;
  nodes: Set<string>;
};

type WindowAccumulator = {
  windowDays: RetentionWindowDays;
  dueProbeCount: number;
  evaluatedProbeCount: number;
  passedCount: number;
  failedCount: number;
  missedFollowUpCount: number;
};

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return Number(sorted[mid]!.toFixed(4));
  }
  return Number((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2).toFixed(4));
}

function stageOrder(stage: CEFRStage) {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function domainOrder(domain: RetentionDomain) {
  const idx = DOMAIN_ORDER.indexOf(domain);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function keyForCohort(probe: RetentionProbe) {
  return `${probe.windowDays}|${probe.stage}|${probe.domain}`;
}

function buildCohortAccumulator(probe: RetentionProbe): CohortAccumulator {
  return {
    windowDays: probe.windowDays,
    stage: probe.stage,
    domain: probe.domain,
    dueProbeCount: 0,
    pendingProbeCount: 0,
    evaluatedProbeCount: 0,
    passedCount: 0,
    failedCount: 0,
    missedFollowUpCount: 0,
    lagValuesDays: [],
    students: new Set(),
    nodes: new Set(),
  };
}

function applyProbeToAccumulator(
  probe: RetentionProbe,
  cohort: CohortAccumulator,
  window: WindowAccumulator,
) {
  cohort.dueProbeCount += 1;
  cohort.students.add(probe.studentId);
  cohort.nodes.add(probe.nodeId);

  window.dueProbeCount += 1;

  if (probe.status === "pending_follow_up") {
    cohort.pendingProbeCount += 1;
    return;
  }

  if (probe.status === "missed_follow_up") {
    cohort.missedFollowUpCount += 1;
    window.missedFollowUpCount += 1;
    return;
  }

  cohort.evaluatedProbeCount += 1;
  window.evaluatedProbeCount += 1;

  if (probe.status === "passed") {
    cohort.passedCount += 1;
    window.passedCount += 1;
  } else {
    cohort.failedCount += 1;
    window.failedCount += 1;
  }

  if (probe.followUpAt) {
    const lagDays = (probe.followUpAt.getTime() - probe.anchorAt.getTime()) / DAY_MS;
    if (Number.isFinite(lagDays) && lagDays >= 0) {
      cohort.lagValuesDays.push(lagDays);
    }
  }
}

function mapEvidenceToObservation(row: EvidenceQueryRow): RetentionEvidenceObservation {
  return {
    studentId: row.studentId,
    nodeId: row.nodeId,
    createdAt: row.createdAt,
    score: row.score,
    stage: mapRetentionStage(row.node.gseCenter),
    domain: mapRetentionDomain({
      domain: row.domain,
      nodeType: row.node.type,
      nodeSkill: row.node.skill,
    }),
  };
}

export function summarizeRetentionCohortProbes(params: {
  probes: RetentionProbe[];
  windowDays: number;
  totalEvidenceRows: number;
  now?: Date;
}): RetentionCohortReport {
  const now = params.now || new Date();

  const cohorts = new Map<string, CohortAccumulator>();
  const windows = new Map<RetentionWindowDays, WindowAccumulator>();

  for (const windowDays of RETENTION_PROBE_WINDOWS) {
    windows.set(windowDays, {
      windowDays,
      dueProbeCount: 0,
      evaluatedProbeCount: 0,
      passedCount: 0,
      failedCount: 0,
      missedFollowUpCount: 0,
    });
  }

  for (const probe of params.probes) {
    const cohortKey = keyForCohort(probe);
    const cohort = cohorts.get(cohortKey) || buildCohortAccumulator(probe);
    const window = windows.get(probe.windowDays);
    if (!window) continue;

    applyProbeToAccumulator(probe, cohort, window);
    cohorts.set(cohortKey, cohort);
  }

  const cohortRows = [...cohorts.values()]
    .sort((a, b) => {
      if (a.windowDays !== b.windowDays) return a.windowDays - b.windowDays;
      const stageDiff = stageOrder(a.stage) - stageOrder(b.stage);
      if (stageDiff !== 0) return stageDiff;
      const domainDiff = domainOrder(a.domain) - domainOrder(b.domain);
      if (domainDiff !== 0) return domainDiff;
      return 0;
    })
    .map((cohort) => ({
      windowDays: cohort.windowDays,
      stage: cohort.stage,
      domain: cohort.domain,
      dueProbeCount: cohort.dueProbeCount,
      pendingProbeCount: cohort.pendingProbeCount,
      evaluatedProbeCount: cohort.evaluatedProbeCount,
      passedCount: cohort.passedCount,
      failedCount: cohort.failedCount,
      missedFollowUpCount: cohort.missedFollowUpCount,
      passRate: ratioOrNull(cohort.passedCount, cohort.evaluatedProbeCount),
      completionRate: ratioOrNull(cohort.evaluatedProbeCount, cohort.dueProbeCount),
      medianFollowUpLagDays: median(cohort.lagValuesDays),
      uniqueStudents: cohort.students.size,
      uniqueNodes: cohort.nodes.size,
    }));

  const windowRows = RETENTION_PROBE_WINDOWS.map((windowDays) => {
    const row = windows.get(windowDays)!;
    return {
      windowDays,
      dueProbeCount: row.dueProbeCount,
      evaluatedProbeCount: row.evaluatedProbeCount,
      passedCount: row.passedCount,
      failedCount: row.failedCount,
      missedFollowUpCount: row.missedFollowUpCount,
      passRate: ratioOrNull(row.passedCount, row.evaluatedProbeCount),
      completionRate: ratioOrNull(row.evaluatedProbeCount, row.dueProbeCount),
    };
  });

  const totalDueProbeCount = cohortRows.reduce((sum, row) => sum + row.dueProbeCount, 0);
  const totalPendingProbeCount = cohortRows.reduce((sum, row) => sum + row.pendingProbeCount, 0);
  const totalEvaluatedProbeCount = cohortRows.reduce((sum, row) => sum + row.evaluatedProbeCount, 0);
  const totalPassedCount = cohortRows.reduce((sum, row) => sum + row.passedCount, 0);
  const totalFailedCount = cohortRows.reduce((sum, row) => sum + row.failedCount, 0);
  const totalMissedFollowUpCount = cohortRows.reduce((sum, row) => sum + row.missedFollowUpCount, 0);

  return retentionCohortReportSchema.parse({
    generatedAt: now.toISOString(),
    contractVersion: RETENTION_COHORT_CONTRACT_VERSION,
    protocolVersion: RETENTION_PROBE_PROTOCOL_VERSION,
    graceDays: RETENTION_PROBE_GRACE_DAYS,
    windowDays: params.windowDays,
    totalEvidenceRows: params.totalEvidenceRows,
    totalDueProbeCount,
    totalPendingProbeCount,
    totalEvaluatedProbeCount,
    totalPassedCount,
    totalFailedCount,
    totalMissedFollowUpCount,
    overallPassRate: ratioOrNull(totalPassedCount, totalEvaluatedProbeCount),
    overallCompletionRate: ratioOrNull(totalEvaluatedProbeCount, totalDueProbeCount),
    windows: windowRows,
    cohorts: cohortRows,
  });
}

export async function buildRetentionCohortReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<RetentionCohortReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(7, Math.min(365, Math.floor(params?.windowDays ?? 90)));
  const limit = Math.max(100, Math.min(200000, Math.floor(params?.limit ?? 60000)));
  const reportFrom = new Date(now.getTime() - windowDays * DAY_MS);
  const evidenceFrom = new Date(
    reportFrom.getTime() - (MAX_PROBE_WINDOW_DAYS + RETENTION_PROBE_GRACE_DAYS) * DAY_MS,
  );

  const rows = await prisma.attemptGseEvidence.findMany({
    where: {
      evidenceKind: "direct",
      createdAt: { gte: evidenceFrom },
    },
    orderBy: [{ studentId: "asc" }, { nodeId: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      studentId: true,
      nodeId: true,
      createdAt: true,
      score: true,
      domain: true,
      node: {
        select: {
          gseCenter: true,
          type: true,
          skill: true,
        },
      },
    },
  });

  const observations = rows.map(mapEvidenceToObservation);
  const probes = buildRetentionProbes({
    rows: observations,
    now,
  }).filter((probe) => probe.anchorAt >= reportFrom);

  const evidenceRowsInWindow = observations.filter(
    (row) => row.createdAt >= reportFrom,
  ).length;

  return summarizeRetentionCohortProbes({
    probes,
    windowDays,
    totalEvidenceRows: evidenceRowsInWindow,
    now,
  });
}
