import { prisma } from "@/lib/db";
import {
  SLO_DASHBOARD_CONTRACT_VERSION,
  SLO_PLANNER_P95_MS_DEFAULT,
  SLO_PLANNER_WINDOW_DAYS_DEFAULT,
  type SloDashboard,
  type SloModuleStatus,
  type SloStatus,
} from "@/lib/contracts/sloDashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? null;
  const w = index - lower;
  const a = sorted[lower] ?? 0;
  const b = sorted[upper] ?? 0;
  return a + w * (b - a);
}

function computeStatus(
  latencyP95: number | null,
  latencyBudget: number | null,
  sampleSize: number,
  minSampleSize: number
): SloStatus {
  if (sampleSize < minSampleSize) return "insufficient_data";
  if (latencyBudget == null) return "ok";
  if (latencyP95 == null) return "insufficient_data";
  return latencyP95 <= latencyBudget ? "ok" : "breach";
}

export async function buildSloDashboard(params?: {
  windowDays?: number;
  plannerBudgetP95Ms?: number;
  now?: Date;
}): Promise<SloDashboard> {
  const now = params?.now ?? new Date();
  const windowDays = params?.windowDays ?? SLO_PLANNER_WINDOW_DAYS_DEFAULT;
  const plannerBudget = params?.plannerBudgetP95Ms ?? SLO_PLANNER_P95_MS_DEFAULT;
  const from = new Date(now.getTime() - windowDays * DAY_MS);

  const plannerRows = await prisma.plannerDecisionLog.findMany({
    where: {
      decisionTs: { gte: from },
      latencyMs: { not: null },
    },
    select: { latencyMs: true },
  });

  const latencies = plannerRows
    .map((r) => r.latencyMs)
    .filter((v): v is number => typeof v === "number" && v >= 0)
    .sort((a, b) => a - b);
  const p95 = percentile(latencies, 95);
  const minSampleSize = 20;
  const plannerStatus: SloModuleStatus = {
    moduleId: "planner",
    label: "Planner (task/next decision)",
    latencyBudgetP95Ms: plannerBudget,
    latencyP95Ms: p95,
    latencySampleSize: latencies.length,
    reliabilityMin: null,
    reliabilityActual: null,
    status: computeStatus(p95, plannerBudget, latencies.length, minSampleSize),
    updatedAt: now.toISOString(),
  };

  const enforcementActive = process.env.SLO_PLANNER_ENFORCE === "true";

  return {
    contractVersion: SLO_DASHBOARD_CONTRACT_VERSION,
    generatedAt: now.toISOString(),
    windowDays,
    modules: [plannerStatus],
    enforcementActive,
  };
}

/** Returns true if planner latency SLO is breached (for enforcement fallback). */
export async function isPlannerSloBreached(params?: {
  windowDays?: number;
  budgetP95Ms?: number;
  minSampleSize?: number;
  now?: Date;
}): Promise<boolean> {
  const dashboard = await buildSloDashboard({
    windowDays: params?.windowDays ?? SLO_PLANNER_WINDOW_DAYS_DEFAULT,
    plannerBudgetP95Ms: params?.budgetP95Ms ?? SLO_PLANNER_P95_MS_DEFAULT,
    now: params?.now,
  });
  const planner = dashboard.modules.find((m) => m.moduleId === "planner");
  return (planner?.status === "breach") === true;
}
