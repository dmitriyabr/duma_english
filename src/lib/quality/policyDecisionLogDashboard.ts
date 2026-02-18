import { prisma } from "@/lib/db";
import {
  normalizePolicyDecisionLogV2Row,
  policyDecisionLogV2DashboardSchema,
  validatePolicyDecisionLogV2Row,
  type PolicyDecisionLogV2Dashboard,
} from "@/lib/contracts/policyDecisionLogV2";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildPolicyDecisionLogDashboard(params?: {
  windowDays?: number;
  limit?: number;
}): Promise<PolicyDecisionLogV2Dashboard> {
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(10, Math.min(50000, Math.floor(params?.limit ?? 5000)));
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const rows = await prisma.policyDecisionLogV2.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      decisionLogId: true,
      studentId: true,
      policyVersion: true,
      contextSnapshotId: true,
      candidateActionSet: true,
      preActionScores: true,
      propensity: true,
      activeConstraints: true,
      linkageTaskId: true,
      linkageAttemptId: true,
      linkageSessionId: true,
      source: true,
    },
  });

  const reasonCounts = new Map<string, number>();
  const versionCounts = new Map<string, number>();
  let validLogs = 0;

  for (const row of rows) {
    versionCounts.set(row.policyVersion, (versionCounts.get(row.policyVersion) || 0) + 1);
    const normalized = normalizePolicyDecisionLogV2Row(row);
    const validation = validatePolicyDecisionLogV2Row(normalized);
    if (validation.valid) {
      validLogs += 1;
      continue;
    }
    for (const issue of validation.issues) {
      reasonCounts.set(issue, (reasonCounts.get(issue) || 0) + 1);
    }
  }

  const totalLogs = rows.length;
  const invalidLogs = totalLogs - validLogs;
  const dashboard = {
    generatedAt: new Date().toISOString(),
    windowDays,
    totalLogs,
    validLogs,
    invalidLogs,
    invalidRate: totalLogs > 0 ? Number((invalidLogs / totalLogs).toFixed(6)) : 0,
    reasons: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    policyVersions: [...versionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([policyVersion, count]) => ({ policyVersion, count })),
  };

  return policyDecisionLogV2DashboardSchema.parse(dashboard);
}
