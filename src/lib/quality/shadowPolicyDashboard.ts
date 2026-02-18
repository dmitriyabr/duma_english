import { prisma } from "@/lib/db";
import {
  extractShadowPolicyTraceFromUtilityJson,
  shadowPolicyDashboardSchema,
  type ShadowPolicyDashboard,
} from "@/lib/contracts/shadowPolicyDashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

type ShadowDashboardRow = {
  chosenTaskType: string;
  utilityJson: unknown;
};

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function summarizeShadowPolicyRows(params: {
  rows: ShadowDashboardRow[];
  windowDays: number;
  now: Date;
}): ShadowPolicyDashboard {
  const modelVersionCounts = new Map<string, number>();
  const disagreementTaskCounts = new Map<string, number>();

  let tracedDecisions = 0;
  let disagreementCount = 0;
  let disagreementAfterSafetyCount = 0;
  let blockedBySafetyGuardCount = 0;
  let highRiskDisagreementCount = 0;
  let verificationGuardTrips = 0;
  let valueGapSum = 0;
  let valueGapCount = 0;

  for (const row of params.rows) {
    const trace = extractShadowPolicyTraceFromUtilityJson(row.utilityJson);
    if (!trace) continue;

    tracedDecisions += 1;
    modelVersionCounts.set(trace.modelVersion, (modelVersionCounts.get(trace.modelVersion) || 0) + 1);

    if (trace.disagreement) {
      disagreementCount += 1;
      disagreementTaskCounts.set(
        row.chosenTaskType,
        (disagreementTaskCounts.get(row.chosenTaskType) || 0) + 1
      );
    }
    if (trace.disagreementAfterSafety) {
      disagreementAfterSafetyCount += 1;
    }
    if (trace.blockedBySafetyGuard) {
      blockedBySafetyGuardCount += 1;
    }

    highRiskDisagreementCount += trace.safetyCounters.highRiskDisagreementCount;
    verificationGuardTrips += trace.safetyCounters.verificationGuardTrips;

    if (typeof trace.valueGapVsRules === "number" && Number.isFinite(trace.valueGapVsRules)) {
      valueGapSum += trace.valueGapVsRules;
      valueGapCount += 1;
    }
  }

  const totalDecisions = params.rows.length;

  return shadowPolicyDashboardSchema.parse({
    generatedAt: params.now.toISOString(),
    windowDays: params.windowDays,
    totalDecisions,
    tracedDecisions,
    traceCoverageRate: totalDecisions > 0 ? round(tracedDecisions / totalDecisions) : 0,
    disagreementRate: tracedDecisions > 0 ? round(disagreementCount / tracedDecisions) : 0,
    disagreementAfterSafetyRate:
      tracedDecisions > 0 ? round(disagreementAfterSafetyCount / tracedDecisions) : 0,
    blockedBySafetyGuardRate:
      tracedDecisions > 0 ? round(blockedBySafetyGuardCount / tracedDecisions) : 0,
    averageValueGap: valueGapCount > 0 ? round(valueGapSum / valueGapCount) : null,
    modelVersions: [...modelVersionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([modelVersion, count]) => ({ modelVersion, count })),
    safetyCounters: {
      highRiskDisagreementCount,
      verificationGuardTrips,
      blockedBySafetyGuardCount,
    },
    disagreementsByTaskType: [...disagreementTaskCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([taskType, count]) => ({ taskType, count })),
  });
}

export async function buildShadowPolicyDashboard(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<ShadowPolicyDashboard> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(10, Math.min(50000, Math.floor(params?.limit ?? 5000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.plannerDecisionLog.findMany({
    where: {
      decisionTs: { gte: since },
    },
    orderBy: {
      decisionTs: "desc",
    },
    take: limit,
    select: {
      chosenTaskType: true,
      utilityJson: true,
    },
  });

  return summarizeShadowPolicyRows({
    rows,
    windowDays,
    now,
  });
}

export const __internal = {
  summarizeShadowPolicyRows,
};
