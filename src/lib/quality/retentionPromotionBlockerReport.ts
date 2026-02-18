import type { CEFRStage } from "@/lib/curriculum";
import { prisma } from "@/lib/db";
import {
  retentionPromotionBlockerReportSchema,
  type RetentionPromotionBlockerReport,
} from "@/lib/contracts/retentionPromotionBlockerReport";
import { RETENTION_PROMOTION_GATE_VERSION } from "@/lib/retention/promotionGate";

const DAY_MS = 24 * 60 * 60 * 1000;
const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

type AuditRow = {
  fromStage: string;
  targetStage: string;
  promoted: boolean;
  reasonsJson: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stageIndex(stage: string) {
  const idx = STAGE_ORDER.indexOf(stage as CEFRStage);
  return idx === -1 ? 0 : idx;
}

function isHighStakesTarget(stage: string) {
  return stageIndex(stage) >= stageIndex("B1");
}

function hasRetentionGateContext(reasonsJson: unknown) {
  const reasons = asObject(reasonsJson);
  const retentionGate = asObject(reasons.retentionGate);
  return Object.keys(retentionGate).length > 0;
}

function readBlockedBundlesReasonCodes(reasonsJson: unknown) {
  const reasons = asObject(reasonsJson);
  const blockedBundles = Array.isArray(reasons.blockedBundles)
    ? reasons.blockedBundles
    : [];
  return blockedBundles
    .map((bundle) => asString(asObject(bundle).reason))
    .filter((value): value is string => Boolean(value));
}

function isBlockedByRetentionGate(row: AuditRow) {
  const reasons = asObject(row.reasonsJson);
  const retentionGate = asObject(reasons.retentionGate);
  if (retentionGate.required === true && retentionGate.passed === false) {
    return true;
  }
  return readBlockedBundlesReasonCodes(row.reasonsJson).includes(
    "retention_gate_not_passed",
  );
}

function retentionBlockerReasons(row: AuditRow) {
  const reasons = asObject(row.reasonsJson);
  const retentionGate = asObject(reasons.retentionGate);
  const explicit = Array.isArray(retentionGate.blockerReasons)
    ? retentionGate.blockerReasons
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value))
    : [];
  if (explicit.length > 0) return explicit;
  if (
    readBlockedBundlesReasonCodes(row.reasonsJson).includes(
      "retention_gate_not_passed",
    )
  ) {
    return ["retention_gate_not_passed"];
  }
  return [];
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

export function summarizeRetentionPromotionAudits(params: {
  rows: AuditRow[];
  windowDays: number;
  now?: Date;
}): RetentionPromotionBlockerReport {
  const now = params.now || new Date();

  let promotedCount = 0;
  let blockedCount = 0;
  let blockedByRetentionCount = 0;
  let highStakesAuditCount = 0;
  let highStakesRetentionBlockedCount = 0;
  let missingRetentionGateContextCount = 0;

  const reasonCounts = new Map<string, number>();
  const transitionCounts = new Map<
    string,
    { fromStage: string; toStage: string; count: number; blockedByRetentionCount: number }
  >();

  for (const row of params.rows) {
    const highStakes = isHighStakesTarget(row.targetStage);
    if (highStakes) {
      highStakesAuditCount += 1;
      if (!hasRetentionGateContext(row.reasonsJson)) {
        missingRetentionGateContextCount += 1;
      }
    }

    if (row.promoted) {
      promotedCount += 1;
    } else {
      blockedCount += 1;
    }

    const blockedByRetention = !row.promoted && isBlockedByRetentionGate(row);
    if (blockedByRetention) {
      blockedByRetentionCount += 1;
      if (highStakes) highStakesRetentionBlockedCount += 1;
      for (const reason of retentionBlockerReasons(row)) {
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
    }

    const transitionKey = `${row.fromStage}->${row.targetStage}`;
    const transition = transitionCounts.get(transitionKey) || {
      fromStage: row.fromStage,
      toStage: row.targetStage,
      count: 0,
      blockedByRetentionCount: 0,
    };
    transition.count += 1;
    if (blockedByRetention) {
      transition.blockedByRetentionCount += 1;
    }
    transitionCounts.set(transitionKey, transition);
  }

  const report = {
    generatedAt: now.toISOString(),
    gateVersion: RETENTION_PROMOTION_GATE_VERSION,
    windowDays: params.windowDays,
    totalAudits: params.rows.length,
    promotedCount,
    blockedCount,
    blockedByRetentionCount,
    blockedByRetentionRate: ratioOrNull(
      blockedByRetentionCount,
      params.rows.length,
    ),
    highStakesAuditCount,
    highStakesRetentionBlockedCount,
    highStakesRetentionBlockedRate: ratioOrNull(
      highStakesRetentionBlockedCount,
      highStakesAuditCount,
    ),
    missingRetentionGateContextCount,
    reasonBreakdown: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    transitionBreakdown: [...transitionCounts.values()].sort((a, b) =>
      a.fromStage === b.fromStage
        ? a.toStage.localeCompare(b.toStage)
        : a.fromStage.localeCompare(b.fromStage),
    ),
  };

  return retentionPromotionBlockerReportSchema.parse(report);
}

export async function buildRetentionPromotionBlockerReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<RetentionPromotionBlockerReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.promotionAudit.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      fromStage: true,
      targetStage: true,
      promoted: true,
      reasonsJson: true,
    },
  });

  return summarizeRetentionPromotionAudits({
    rows,
    windowDays,
    now,
  });
}
