import { prisma } from "@/lib/db";
import {
  LISTENING_TRANSFER_RETENTION_REPORT_VERSION,
  listeningTransferRetentionReportSchema,
  type ListeningTransferRetentionReport,
} from "@/lib/contracts/listeningTransferRetentionReport";
import { isListeningTaskType } from "@/lib/listening/assessment";
import {
  buildRetentionProbes,
  mapRetentionDomain,
  mapRetentionStage,
  type RetentionEvidenceObservation,
} from "@/lib/retention/probes";

const DAY_MS = 24 * 60 * 60 * 1000;
const PASS_SCORE = 0.65;
const RETENTION_GRACE_DAYS = 21;

type AttemptRow = {
  id: string;
  studentId: string;
  taskId: string;
  createdAt: Date;
  taskEvaluationJson: unknown;
  scoresJson: unknown;
  task: {
    type: string;
    metaJson: unknown;
  } | null;
};

type StageAccumulator = {
  attempts: number;
  passedCount: number;
  taskScoreSum: number;
  taskScoreCount: number;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStage(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "unknown";
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

export async function buildListeningTransferRetentionReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<ListeningTransferRetentionReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const [attemptRows, oodRows, evidenceRows] = await Promise.all([
    prisma.attempt.findMany({
      where: {
        createdAt: { gte: since },
        status: "completed",
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        studentId: true,
        taskId: true,
        createdAt: true,
        taskEvaluationJson: true,
        scoresJson: true,
        task: { select: { type: true, metaJson: true } },
      },
    }),
    prisma.oODTaskSpec.findMany({
      where: {
        createdAt: { gte: since },
        taskInstanceId: { not: null },
        taskInstance: {
          task: { type: "listening_comprehension" },
        },
      },
      select: {
        id: true,
        verdict: true,
        status: true,
      },
    }),
    prisma.attemptGseEvidence.findMany({
      where: {
        attempt: {
          status: "completed",
          createdAt: { gte: since },
          task: { type: "listening_comprehension" },
        },
      },
      select: {
        studentId: true,
        nodeId: true,
        score: true,
        createdAt: true,
        node: { select: { gseCenter: true, type: true, skill: true } },
      },
    }),
  ]);

  const listeningRows = attemptRows.filter((row) =>
    isListeningTaskType(row.task?.type || "")
  ) as AttemptRow[];

  const taskScores: number[] = [];
  const byStage = new Map<string, StageAccumulator>();
  let passCount = 0;
  let scoredCount = 0;

  for (const row of listeningRows) {
    const taskMeta = asObject(row.task?.metaJson);
    const stage = asStage(taskMeta.stage);
    const taskEvaluation = asObject(row.taskEvaluationJson);
    const scores = asObject(row.scoresJson);
    const taskScore = asNumber(scores.taskScore) ?? asNumber(taskEvaluation.taskScore);

    if (typeof taskScore === "number") {
      taskScores.push(taskScore);
      scoredCount += 1;
      if (taskScore >= 65) passCount += 1;
    }

    const bucket = byStage.get(stage) || {
      attempts: 0,
      passedCount: 0,
      taskScoreSum: 0,
      taskScoreCount: 0,
    };
    bucket.attempts += 1;
    if (typeof taskScore === "number") {
      bucket.taskScoreSum += taskScore;
      bucket.taskScoreCount += 1;
      if (taskScore >= 65) bucket.passedCount += 1;
    }
    byStage.set(stage, bucket);
  }

  const byStageRows = [...byStage.entries()]
    .sort((a, b) => b[1].attempts - a[1].attempts || a[0].localeCompare(b[0]))
    .map(([stage, acc]) => ({
      stage,
      attempts: acc.attempts,
      avgTaskScore:
        acc.taskScoreCount > 0
          ? Number((acc.taskScoreSum / acc.taskScoreCount).toFixed(6))
          : null,
      passRate: ratioOrNull(acc.passedCount, acc.taskScoreCount),
    }));

  const listeningOodEvaluated = oodRows.filter((r) => r.status === "evaluated" && r.verdict);
  const transferPass = listeningOodEvaluated.filter((r) => r.verdict === "transfer_pass").length;
  const transferFail = listeningOodEvaluated.filter(
    (r) => r.verdict === "transfer_fail_validated"
  ).length;
  const transferEvaluable = transferPass + transferFail;

  const observations: RetentionEvidenceObservation[] = evidenceRows.map((row) => {
    const node = row.node;
    const gseCenter = node?.gseCenter ?? null;
    const stage = mapRetentionStage(gseCenter);
    const domain = mapRetentionDomain({
      nodeType: node?.type ?? null,
      nodeSkill: node?.skill ?? null,
    });
    return {
      studentId: row.studentId,
      nodeId: row.nodeId,
      createdAt: row.createdAt,
      score: row.score,
      stage,
      domain,
    };
  });

  const probes = buildRetentionProbes({
    rows: observations,
    now,
    windows: [7, 30],
    passScore: PASS_SCORE,
    graceDays: RETENTION_GRACE_DAYS,
  });

  const window7 = probes.filter((p) => p.windowDays === 7);
  const window30 = probes.filter((p) => p.windowDays === 30);
  const retention7dEvaluated = window7.filter(
    (p) => p.status === "passed" || p.status === "failed" || p.status === "missed_follow_up"
  ).length;
  const retention7dPassed = window7.filter((p) => p.status === "passed").length;
  const retention30dEvaluated = window30.filter(
    (p) => p.status === "passed" || p.status === "failed" || p.status === "missed_follow_up"
  ).length;
  const retention30dPassed = window30.filter((p) => p.status === "passed").length;

  const report: ListeningTransferRetentionReport = listeningTransferRetentionReportSchema.parse({
    generatedAt: now.toISOString(),
    contractVersion: LISTENING_TRANSFER_RETENTION_REPORT_VERSION,
    windowDays,
    totalAttempts: attemptRows.length,
    listeningAttempts: listeningRows.length,
    scoredListeningAttempts: scoredCount,
    avgTaskScore:
      taskScores.length > 0
        ? Number((taskScores.reduce((s, v) => s + v, 0) / taskScores.length).toFixed(6))
        : null,
    passRate: ratioOrNull(passCount, scoredCount),
    transfer: {
      evaluableCount: transferEvaluable,
      passCount: transferPass,
      failCount: transferFail,
      passRate: ratioOrNull(transferPass, transferEvaluable),
    },
    retention: {
      window7dCount: retention7dEvaluated,
      window7dPassRate: ratioOrNull(retention7dPassed, retention7dEvaluated),
      window30dCount: retention30dEvaluated,
      window30dPassRate: ratioOrNull(retention30dPassed, retention30dEvaluated),
    },
    byStage: byStageRows,
  });

  return report;
}
