import { prisma } from "@/lib/db";
import {
  OPERATIONAL_PLAYBOOKS_CONTRACT_VERSION,
  type IncidentOutcome,
  type OperationalPlaybooksReport,
} from "@/lib/contracts/operationalPlaybooks";
import {
  evaluateRetryLoopTrigger,
  evaluateCausePlateauTrigger,
  evaluateWeakTransferTrigger,
  evaluateFastProgressLowReliabilityTrigger,
  type RetryLoopRow,
  type CausePlateauRow,
  type WeakTransferRow,
  type FastProgressLowReliabilityRow,
} from "@/lib/playbooks/triggers";

const DAY_MS = 24 * 60 * 60 * 1000;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function buildOperationalPlaybooksReport(params: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<OperationalPlaybooksReport> {
  const now = params.now ?? new Date();
  const windowDays = Math.max(1, params.windowDays ?? 14);
  const limit = Math.min(10000, Math.max(100, params.limit ?? 2000));
  const from = new Date(now.getTime() - windowDays * DAY_MS);

  const [attempts, causalRows, oodRows, stageProjections] = await Promise.all([
    prisma.attempt.findMany({
      where: {
        createdAt: { gte: from },
        status: { in: ["completed", "NEEDS_RETRY"] },
      },
      select: { studentId: true, status: true, createdAt: true, scoresJson: true },
      orderBy: { createdAt: "desc" },
      take: limit * 2,
    }),
    prisma.causalDiagnosis.findMany({
      where: { createdAt: { gte: from } },
      select: { studentId: true, topLabel: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit * 2,
    }),
    prisma.oODTaskSpec.findMany({
      where: {
        createdAt: { gte: from },
        taskInstanceId: { not: null },
        verdict: { not: null },
      },
      select: { studentId: true, verdict: true },
    }),
    prisma.gseStageProjection.findMany({
      where: { createdAt: { gte: from } },
      select: { studentId: true, evidenceJson: true, createdAt: true },
      orderBy: [{ studentId: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  const incidents: IncidentOutcome[] = [];
  const summary = {
    retry_loop: 0,
    cause_plateau: 0,
    weak_transfer_high_indomain: 0,
    fast_progress_low_reliability: 0,
    total: 0,
  };

  const byStudentAttempts = new Map<string, RetryLoopRow[]>();
  for (const a of attempts) {
    const list = byStudentAttempts.get(a.studentId) ?? [];
    list.push({
      studentId: a.studentId,
      status: a.status,
      createdAt: a.createdAt,
    });
    byStudentAttempts.set(a.studentId, list);
  }

  for (const [studentId, list] of byStudentAttempts) {
    const trigger = evaluateRetryLoopTrigger(list, now);
    if (trigger) {
      incidents.push({ trigger, outcomeStatus: "open" });
      summary.retry_loop += 1;
    }
  }

  const byStudentCausal = new Map<string, CausePlateauRow[]>();
  for (const c of causalRows) {
    const list = byStudentCausal.get(c.studentId) ?? [];
    list.push({
      studentId: c.studentId,
      topLabel: c.topLabel,
      createdAt: c.createdAt,
    });
    byStudentCausal.set(c.studentId, list);
  }

  for (const [studentId, list] of byStudentCausal) {
    const trigger = evaluateCausePlateauTrigger(list, now);
    if (trigger) {
      incidents.push({ trigger, outcomeStatus: "open" });
      summary.cause_plateau += 1;
    }
  }

  const inDomainByStudent = new Map<
    string,
    { pass: number; total: number }
  >();
  for (const a of attempts) {
    if (a.status !== "completed") continue;
    const scores = asObject(a.scoresJson);
    const overall = typeof scores.overallScore === "number" ? scores.overallScore : 0;
    const cur = inDomainByStudent.get(a.studentId) ?? { pass: 0, total: 0 };
    cur.total += 1;
    if (overall >= 70) cur.pass += 1;
    inDomainByStudent.set(a.studentId, cur);
  }

  const oodByStudent = new Map<string, { pass: number; evaluable: number }>();
  for (const o of oodRows) {
    const v = (o.verdict ?? "").toLowerCase();
    const evaluable = v && v !== "none";
    const pass = v === "transfer_pass" || v.includes("pass");
    const cur = oodByStudent.get(o.studentId) ?? { pass: 0, evaluable: 0 };
    if (evaluable) {
      cur.evaluable += 1;
      if (pass) cur.pass += 1;
    }
    oodByStudent.set(o.studentId, cur);
  }

  for (const studentId of new Set([...inDomainByStudent.keys(), ...oodByStudent.keys()])) {
    const inDom = inDomainByStudent.get(studentId);
    const ood = oodByStudent.get(studentId);
    if (!inDom || !ood) continue;
    const row: WeakTransferRow = {
      studentId,
      inDomainPassCount: inDom.pass,
      inDomainTotal: inDom.total,
      oodPassCount: ood.pass,
      oodEvaluable: ood.evaluable,
    };
    const trigger = evaluateWeakTransferTrigger(row, now);
    if (trigger) {
      incidents.push({ trigger, outcomeStatus: "open" });
      summary.weak_transfer_high_indomain += 1;
    }
  }

  const latestProjectionByStudent = new Map<string, { evidenceJson: unknown; createdAt: Date }>();
  for (const p of stageProjections) {
    if (!latestProjectionByStudent.has(p.studentId)) {
      latestProjectionByStudent.set(p.studentId, {
        evidenceJson: p.evidenceJson,
        createdAt: p.createdAt,
      });
    }
  }

  for (const [studentId, proj] of latestProjectionByStudent) {
    const ev = asObject(proj.evidenceJson);
    const placementStage = (ev.placementStage as string) ?? "A0";
    const targetStats = asObject(ev.targetStageStats);
    const reliabilityRatio =
      typeof targetStats.reliabilityRatio === "number" ? targetStats.reliabilityRatio : null;
    const row: FastProgressLowReliabilityRow = {
      studentId,
      placementStage,
      targetStageStatsReliabilityRatio: reliabilityRatio,
    };
    const trigger = evaluateFastProgressLowReliabilityTrigger(row, now);
    if (trigger) {
      incidents.push({ trigger, outcomeStatus: "open" });
      summary.fast_progress_low_reliability += 1;
    }
  }

  summary.total = incidents.length;

  return {
    contractVersion: OPERATIONAL_PLAYBOOKS_CONTRACT_VERSION,
    generatedAt: now.toISOString(),
    window: {
      from: from.toISOString(),
      to: now.toISOString(),
      windowDays,
    },
    incidents,
    summary,
  };
}
