import { prisma } from "@/lib/db";
import { getRuntimeFeatureFlags } from "@/lib/featureFlags";
import {
  runtimeRolloutDashboardSchema,
  type RuntimeRolloutDashboardReport,
} from "@/lib/contracts/runtimeRolloutDashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function detectListeningPromptLeak(params: { prompt: string; script: string | null }) {
  if (/(^|\n)\s*audio\s*:/i.test(params.prompt)) return true;
  if (!params.script) return false;

  const normalizedPrompt = normalizeText(params.prompt);
  const normalizedScript = normalizeText(params.script);
  if (!normalizedPrompt || !normalizedScript) return false;

  const probe = normalizedScript.slice(0, 32);
  if (probe.length < 12) return false;
  return normalizedPrompt.includes(probe);
}

function rate(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function extractPromotionBlockReasons(reasonsJson: unknown) {
  const reasons = asObject(reasonsJson);
  const blockedBundles = Array.isArray(reasons.blockedBundles)
    ? reasons.blockedBundles
    : [];
  return blockedBundles.flatMap((item) => {
    const raw = asString(asObject(item).reason);
    if (!raw) return [];
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  });
}

type RolloutSummaryInput = {
  windowDays: number;
  now: Date;
  listeningRows: Array<{
    specJson: unknown;
    task: {
      prompt: string;
      metaJson: unknown;
    } | null;
  }>;
  plannerRows: Array<{
    utilityJson: unknown;
  }>;
  completedAttempts: number;
  causalRows: Array<{
    attemptId: string;
    topLabel: string;
  }>;
  promotionRows: Array<{
    blockedByNodes: string[];
    reasonsJson: unknown;
  }>;
};

export function summarizeRuntimeRolloutDashboard(input: RolloutSummaryInput) {
  const flags = getRuntimeFeatureFlags();

  const listeningMetrics = input.listeningRows.reduce(
    (acc, row) => {
      const spec = asObject(row.specJson);
      const listeningSpec = asObject(spec.listening);
      const assetId = asString(listeningSpec.assetId);
      if (assetId) acc.withAudioPayload += 1;

      const taskMeta = asObject(row.task?.metaJson);
      const hiddenScript = asString(taskMeta.listeningScript);
      if (detectListeningPromptLeak({ prompt: row.task?.prompt || "", script: hiddenScript })) {
        acc.promptLeakCount += 1;
      }
      return acc;
    },
    { withAudioPayload: 0, promptLeakCount: 0 },
  );

  const memoryMetrics = input.plannerRows.reduce(
    (acc, row) => {
      const utility = asObject(row.utilityJson);
      const queueDue = asObject(utility.memoryQueueDue);
      const dueCount = asNumber(queueDue.dueCount) ?? 0;
      const hits = asNumber(utility.memoryQueueHits) ?? 0;
      const overrideApplied = utility.memoryDueOverrideApplied === true;

      if (dueCount > 0) {
        acc.backlogDecisions += 1;
        if (hits > 0) acc.backlogHitDecisions += 1;
      }
      if (overrideApplied) acc.dueOverrideCount += 1;
      return acc;
    },
    { backlogDecisions: 0, backlogHitDecisions: 0, dueOverrideCount: 0 },
  );

  const causalAttemptIds = new Set<string>();
  const topLabelCounts = new Map<string, number>();
  for (const row of input.causalRows) {
    causalAttemptIds.add(row.attemptId);
    const label = row.topLabel.trim() || "unknown";
    topLabelCounts.set(label, (topLabelCounts.get(label) || 0) + 1);
  }

  let blockedAudits = 0;
  const promotionReasonCounts = new Map<string, number>();
  for (const row of input.promotionRows) {
    const reasons = extractPromotionBlockReasons(row.reasonsJson);
    const blocked = row.blockedByNodes.length > 0 || reasons.length > 0;
    if (!blocked) continue;
    blockedAudits += 1;
    const effectiveReasons = reasons.length > 0 ? reasons : ["unknown_blocker"];
    for (const reason of effectiveReasons) {
      promotionReasonCounts.set(reason, (promotionReasonCounts.get(reason) || 0) + 1);
    }
  }

  return runtimeRolloutDashboardSchema.parse({
    generatedAt: input.now.toISOString(),
    windowDays: input.windowDays,
    flags,
    listeningAuthenticity: {
      tasksIssued: input.listeningRows.length,
      withAudioPayload: listeningMetrics.withAudioPayload,
      promptLeakCount: listeningMetrics.promptLeakCount,
      scriptLeakRate: rate(listeningMetrics.promptLeakCount, input.listeningRows.length),
    },
    memoryRuntime: {
      decisions: input.plannerRows.length,
      backlogDecisions: memoryMetrics.backlogDecisions,
      backlogHitDecisions: memoryMetrics.backlogHitDecisions,
      backlogHitRate: rate(memoryMetrics.backlogHitDecisions, memoryMetrics.backlogDecisions),
      dueOverrideCount: memoryMetrics.dueOverrideCount,
    },
    causalCoach: {
      completedAttempts: input.completedAttempts,
      withCausalDiagnosis: causalAttemptIds.size,
      exposureRate: rate(causalAttemptIds.size, input.completedAttempts),
      topLabels: [...topLabelCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, count })),
    },
    promotionBlocks: {
      audits: input.promotionRows.length,
      blockedAudits,
      reasons: [...promotionReasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count })),
    },
  });
}

export async function buildRuntimeRolloutDashboardReport(params?: {
  windowDays?: number;
  now?: Date;
  limit?: number;
}): Promise<RuntimeRolloutDashboardReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const [listeningRows, plannerRows, completedAttempts, causalRows, promotionRows] = await Promise.all([
    prisma.taskInstance.findMany({
      where: {
        taskType: "listening_comprehension",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        specJson: true,
        task: {
          select: {
            prompt: true,
            metaJson: true,
          },
        },
      },
    }),
    prisma.plannerDecisionLog.findMany({
      where: { decisionTs: { gte: since } },
      orderBy: { decisionTs: "desc" },
      take: limit,
      select: { utilityJson: true },
    }),
    prisma.attempt.count({
      where: {
        status: "completed",
        createdAt: { gte: since },
      },
    }),
    prisma.causalDiagnosis.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        attemptId: true,
        topLabel: true,
      },
    }),
    prisma.promotionAudit.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        blockedByNodes: true,
        reasonsJson: true,
      },
    }),
  ]);

  return summarizeRuntimeRolloutDashboard({
    now,
    windowDays,
    listeningRows,
    plannerRows,
    completedAttempts,
    causalRows,
    promotionRows,
  });
}
