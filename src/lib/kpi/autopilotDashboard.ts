import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { ATTEMPT_STATUS } from "@/lib/attemptStatus";
import {
  AUTOPILOT_KPI_METRIC_IDS,
  buildMetricComparison,
  buildMetricSnapshot,
  type AutopilotKpiBaselineReport,
  type AutopilotKpiDashboard,
  type AutopilotKpiMetricSnapshot,
  autopilotKpiBaselineReportSchema,
  autopilotKpiDashboardSchema,
  verifyAutopilotKpiBaselineSignature,
} from "@/lib/contracts/autopilotKpi";
import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_PASS_SCORE = 0.7;
const RETENTION_GRACE_DAYS = 21;
const DEFAULT_RETENTION_LOOKBACK_DAYS = 365;

export const DEFAULT_CH05_BASELINE_REPORT_PATH = path.join(
  process.cwd(),
  "docs/reports/CH05_KPI_BASELINE_REPORT.json"
);

export type KpiAttemptRow = {
  status: string;
  durationSec: number | null;
  recoveryTriggered: boolean;
  taskEvaluationJson: unknown;
  nodeOutcomesJson: unknown;
};

export type KpiOodVerdictRow = {
  verdict: string | null;
};

export type KpiRetentionEvidenceRow = {
  studentId: string;
  nodeId: string;
  createdAt: Date;
  score: number;
};

type ParsedNodeOutcome = {
  deltaMastery: number;
  activationImpact: string | null;
};

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMetric(value: number) {
  return Number(value.toFixed(4));
}

function parseTaskScore(taskEvaluationJson: unknown) {
  if (!taskEvaluationJson || typeof taskEvaluationJson !== "object") return null;
  return toFiniteNumber((taskEvaluationJson as Record<string, unknown>).taskScore);
}

function parseNodeOutcomes(nodeOutcomesJson: unknown): ParsedNodeOutcome[] {
  if (!Array.isArray(nodeOutcomesJson)) return [];
  const outcomes: ParsedNodeOutcome[] = [];
  for (const row of nodeOutcomesJson) {
    if (!row || typeof row !== "object") continue;
    const parsed = row as Record<string, unknown>;
    const deltaMastery = toFiniteNumber(parsed.deltaMastery);
    if (deltaMastery === null) continue;
    outcomes.push({
      deltaMastery,
      activationImpact: typeof parsed.activationImpact === "string" ? parsed.activationImpact : null,
    });
  }
  return outcomes;
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function computeMasteryGainPerHourMetric(params: {
  attempts: KpiAttemptRow[];
  windowDays: number;
}): AutopilotKpiMetricSnapshot {
  const completed = params.attempts.filter((row) => row.status === ATTEMPT_STATUS.COMPLETED);
  let activeHours = 0;
  let netDelta = 0;
  let outcomeCount = 0;

  for (const row of completed) {
    const durationSec = toFiniteNumber(row.durationSec);
    if (durationSec === null || durationSec <= 0) continue;
    const outcomes = parseNodeOutcomes(row.nodeOutcomesJson);
    if (outcomes.length === 0) continue;
    activeHours += durationSec / 3600;
    outcomeCount += outcomes.length;
    for (const outcome of outcomes) {
      netDelta += outcome.deltaMastery;
    }
  }

  const value = activeHours > 0 ? netDelta / activeHours : null;
  return buildMetricSnapshot({
    metricId: "mastery_gain_per_hour",
    value,
    sampleSize: completed.length,
    windowDays: params.windowDays,
    numerator: netDelta,
    denominator: activeHours,
    notes: `completed_attempts=${completed.length}, node_outcomes=${outcomeCount}`,
  });
}

export function computeVerifiedGrowthMetric(params: {
  attempts: KpiAttemptRow[];
  windowDays: number;
}): AutopilotKpiMetricSnapshot {
  const completed = params.attempts.filter((row) => row.status === ATTEMPT_STATUS.COMPLETED);
  const verifiedTransitions = completed.reduce((total, row) => {
    const outcomes = parseNodeOutcomes(row.nodeOutcomesJson);
    return total + outcomes.filter((outcome) => outcome.activationImpact === "verified").length;
  }, 0);
  const value = completed.length > 0 ? (verifiedTransitions * 100) / completed.length : null;
  return buildMetricSnapshot({
    metricId: "verified_growth_per_100_attempts",
    value,
    sampleSize: completed.length,
    windowDays: params.windowDays,
    numerator: verifiedTransitions,
    denominator: completed.length,
    notes: `verified_transitions=${verifiedTransitions}`,
  });
}

export function computeFrustrationProxyMetric(params: {
  attempts: KpiAttemptRow[];
  windowDays: number;
}): AutopilotKpiMetricSnapshot {
  const terminal = params.attempts.filter(
    (row) => row.status === ATTEMPT_STATUS.COMPLETED || row.status === ATTEMPT_STATUS.NEEDS_RETRY
  );
  const frustrationSignals = terminal.reduce((count, row) => {
    const taskScore = parseTaskScore(row.taskEvaluationJson);
    const hasSignal =
      row.status === ATTEMPT_STATUS.NEEDS_RETRY ||
      row.recoveryTriggered ||
      (typeof taskScore === "number" && taskScore < 45);
    return count + (hasSignal ? 1 : 0);
  }, 0);
  const value = terminal.length > 0 ? frustrationSignals / terminal.length : null;
  return buildMetricSnapshot({
    metricId: "frustration_proxy_rate",
    value,
    sampleSize: terminal.length,
    windowDays: params.windowDays,
    numerator: frustrationSignals,
    denominator: terminal.length,
    notes: `terminal_attempts=${terminal.length}`,
  });
}

export function computePlannerLatencyMetric(params: {
  latenciesMs: Array<number | null>;
  windowDays: number;
}): AutopilotKpiMetricSnapshot {
  const values = params.latenciesMs
    .map((value) => toFiniteNumber(value))
    .filter((value): value is number => value !== null && value >= 0);
  const p95 = percentile(values, 95);
  return buildMetricSnapshot({
    metricId: "planner_latency_p95_ms",
    value: p95,
    sampleSize: values.length,
    windowDays: params.windowDays,
    notes: values.length > 0 ? `p50=${roundMetric(percentile(values, 50) || 0)}` : "no_latency_samples",
  });
}

function normalizeOodVerdict(verdict: string | null) {
  if (!verdict) return "unknown" as const;
  const normalized = verdict.trim().toLowerCase();
  if (!normalized) return "unknown" as const;
  if (
    normalized.includes("pass") ||
    normalized === "ok" ||
    normalized === "success" ||
    normalized === "completed_pass"
  ) {
    return "pass" as const;
  }
  if (
    normalized.includes("fail") ||
    normalized.includes("block") ||
    normalized.includes("reject") ||
    normalized.includes("miss")
  ) {
    return "fail" as const;
  }
  return "unknown" as const;
}

export function computeOodPassRateMetric(params: {
  rows: KpiOodVerdictRow[];
  windowDays: number;
}): AutopilotKpiMetricSnapshot {
  let pass = 0;
  let fail = 0;
  let unknown = 0;
  for (const row of params.rows) {
    const verdict = normalizeOodVerdict(row.verdict);
    if (verdict === "pass") pass += 1;
    else if (verdict === "fail") fail += 1;
    else unknown += 1;
  }
  const evaluated = pass + fail;
  const value = evaluated > 0 ? pass / evaluated : null;
  return buildMetricSnapshot({
    metricId: "ood_pass_rate",
    value,
    sampleSize: evaluated,
    windowDays: params.windowDays,
    numerator: pass,
    denominator: evaluated,
    notes: `unknown_verdicts=${unknown}`,
  });
}

export function computeRetentionPassRateMetric(params: {
  rows: KpiRetentionEvidenceRow[];
  retentionWindowDays: 7 | 30 | 90;
  now?: Date;
}): AutopilotKpiMetricSnapshot {
  const now = params.now || new Date();
  const latestAnchorTs = now.getTime() - params.retentionWindowDays * DAY_MS;
  const grouped = new Map<string, KpiRetentionEvidenceRow[]>();
  for (const row of params.rows) {
    const key = `${row.studentId}:${row.nodeId}`;
    const items = grouped.get(key);
    if (items) items.push(row);
    else grouped.set(key, [row]);
  }

  let passed = 0;
  let evaluated = 0;
  for (const events of grouped.values()) {
    events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < events.length; i += 1) {
      const anchor = events[i];
      if (anchor.score < RETENTION_PASS_SCORE) continue;
      if (anchor.createdAt.getTime() > latestAnchorTs) continue;

      const minFollowUpTs = anchor.createdAt.getTime() + params.retentionWindowDays * DAY_MS;
      const maxFollowUpTs = minFollowUpTs + RETENTION_GRACE_DAYS * DAY_MS;
      let followUp: KpiRetentionEvidenceRow | null = null;
      for (let j = i + 1; j < events.length; j += 1) {
        const candidate = events[j];
        const ts = candidate.createdAt.getTime();
        if (ts < minFollowUpTs) continue;
        if (ts > maxFollowUpTs) break;
        followUp = candidate;
        break;
      }
      if (!followUp) continue;
      evaluated += 1;
      if (followUp.score >= RETENTION_PASS_SCORE) passed += 1;
    }
  }

  const value = evaluated > 0 ? passed / evaluated : null;
  const metricId = `retention_pass_rate_${params.retentionWindowDays}d` as const;
  return buildMetricSnapshot({
    metricId,
    value,
    sampleSize: evaluated,
    windowDays: params.retentionWindowDays,
    numerator: passed,
    denominator: evaluated,
    notes: `grace_days=${RETENTION_GRACE_DAYS}`,
  });
}

function mapError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `prisma:${error.code}`;
  }
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }
  return "unknown_error";
}

async function fetchOodVerdicts(from: Date) {
  return prisma.$queryRaw<KpiOodVerdictRow[]>(
    Prisma.sql`SELECT "verdict" FROM "OODTaskSpec" WHERE "createdAt" >= ${from} AND "verdict" IS NOT NULL`
  );
}

export async function loadAutopilotKpiBaselineReport(pathToReport = DEFAULT_CH05_BASELINE_REPORT_PATH): Promise<{
  report: AutopilotKpiBaselineReport | null;
  warning?: string;
}> {
  try {
    const raw = await fs.readFile(pathToReport, "utf8");
    const parsed = autopilotKpiBaselineReportSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { report: null, warning: "baseline_parse_failed" };
    }
    if (!verifyAutopilotKpiBaselineSignature(parsed.data)) {
      return { report: null, warning: "baseline_signature_invalid" };
    }
    return { report: parsed.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { report: null };
    }
    return { report: null, warning: `baseline_load_failed:${mapError(error)}` };
  }
}

function emptyMetrics(windowDays: number, note: string) {
  return AUTOPILOT_KPI_METRIC_IDS.map((metricId) =>
    buildMetricSnapshot({
      metricId,
      value: null,
      sampleSize: 0,
      windowDays: metricId.startsWith("retention_pass_rate_")
        ? Number(metricId.split("_")[3].replace("d", ""))
        : windowDays,
      status: "not_available",
      notes: note,
    })
  );
}

export async function buildAutopilotKpiDashboard(params?: {
  windowDays?: number;
  now?: Date;
  includeBaseline?: boolean;
  baselinePath?: string;
}): Promise<AutopilotKpiDashboard> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, params?.windowDays || 30);
  const from = new Date(now.getTime() - windowDays * DAY_MS);
  const retentionFrom = new Date(now.getTime() - Math.max(DEFAULT_RETENTION_LOOKBACK_DAYS, windowDays + 120) * DAY_MS);
  const warnings: string[] = [];

  let metrics: AutopilotKpiMetricSnapshot[];
  try {
    const [attempts, latencyRows, oodRows, retentionRows] = await Promise.all([
      prisma.attempt.findMany({
        where: {
          createdAt: { gte: from },
          status: {
            in: [ATTEMPT_STATUS.COMPLETED, ATTEMPT_STATUS.NEEDS_RETRY],
          },
        },
        select: {
          status: true,
          durationSec: true,
          recoveryTriggered: true,
          taskEvaluationJson: true,
          nodeOutcomesJson: true,
        },
      }),
      prisma.plannerDecisionLog.findMany({
        where: {
          decisionTs: { gte: from },
          latencyMs: { not: null },
        },
        select: { latencyMs: true },
      }),
      fetchOodVerdicts(from),
      prisma.attemptGseEvidence.findMany({
        where: {
          createdAt: { gte: retentionFrom },
          evidenceKind: "direct",
        },
        select: {
          studentId: true,
          nodeId: true,
          createdAt: true,
          score: true,
        },
        orderBy: [{ studentId: "asc" }, { nodeId: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    metrics = [
      computeMasteryGainPerHourMetric({ attempts, windowDays }),
      computeVerifiedGrowthMetric({ attempts, windowDays }),
      computeRetentionPassRateMetric({ rows: retentionRows, retentionWindowDays: 7, now }),
      computeRetentionPassRateMetric({ rows: retentionRows, retentionWindowDays: 30, now }),
      computeRetentionPassRateMetric({ rows: retentionRows, retentionWindowDays: 90, now }),
      computeOodPassRateMetric({ rows: oodRows, windowDays }),
      computeFrustrationProxyMetric({ attempts, windowDays }),
      computePlannerLatencyMetric({ latenciesMs: latencyRows.map((row) => row.latencyMs), windowDays }),
    ];
  } catch (error) {
    warnings.push(`kpi_data_fetch_failed:${mapError(error)}`);
    metrics = emptyMetrics(windowDays, "db_unavailable");
  }

  const includeBaseline = params?.includeBaseline !== false;
  let baseline: AutopilotKpiDashboard["baseline"];
  let comparisons: AutopilotKpiDashboard["comparisons"];

  if (includeBaseline) {
    const baselineResult = await loadAutopilotKpiBaselineReport(params?.baselinePath || DEFAULT_CH05_BASELINE_REPORT_PATH);
    if (baselineResult.warning) warnings.push(baselineResult.warning);
    if (baselineResult.report) {
      baseline = {
        reportId: baselineResult.report.reportId,
        signedBy: baselineResult.report.signoff.signedBy,
        signedAt: baselineResult.report.signoff.signedAt,
        signature: baselineResult.report.signoff.signature,
      };
      const baselineById = new Map(
        baselineResult.report.metrics.map((metric) => [metric.metricId, metric.value] as const)
      );
      comparisons = AUTOPILOT_KPI_METRIC_IDS.map((metricId) => {
        const current = metrics.find((metric) => metric.metricId === metricId)?.value ?? null;
        const frozen = baselineById.get(metricId) ?? null;
        return buildMetricComparison({
          metricId,
          currentValue: current,
          baselineValue: frozen,
        });
      });
    }
  }

  return autopilotKpiDashboardSchema.parse({
    contractVersion: "autopilot-kpi-v1",
    generatedAt: now.toISOString(),
    window: {
      from: from.toISOString(),
      to: now.toISOString(),
      windowDays,
    },
    metrics,
    baseline,
    comparisons,
    warnings,
  });
}
