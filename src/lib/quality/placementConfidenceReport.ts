import { prisma } from "@/lib/db";
import {
  PLACEMENT_CONFIDENCE_REPORT_VERSION,
  placementConfidenceReportSchema,
  type PlacementConfidenceReport,
} from "@/lib/contracts/placementConfidenceReport";
import type { PlacementDomain } from "@/lib/placement/crossModality";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEMENT_DOMAINS: PlacementDomain[] = [
  "speaking",
  "listening",
  "reading",
  "writing",
  "grammar",
  "vocabulary",
];

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type DomainAgg = {
  placementCount: number;
  totalSampleCount: number;
  confidenceSum: number;
  confidenceCount: number;
  uncertaintySum: number;
  uncertaintyCount: number;
};

export async function buildPlacementConfidenceReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<PlacementConfidenceReport> {
  const now = params?.now ?? new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 90)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 5000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.promotionAudit.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { reasonsJson: true },
  });

  const placementRows = rows.filter((row) => {
    const reasons = asObject(row.reasonsJson);
    return reasons.placement === true && reasons.crossModalityPlacement != null;
  });

  const byDomain = new Map<PlacementDomain, DomainAgg>();
  for (const domain of PLACEMENT_DOMAINS) {
    byDomain.set(domain, {
      placementCount: 0,
      totalSampleCount: 0,
      confidenceSum: 0,
      confidenceCount: 0,
      uncertaintySum: 0,
      uncertaintyCount: 0,
    });
  }

  for (const row of placementRows) {
    const reasons = asObject(row.reasonsJson);
    const crossMod = asObject(reasons.crossModalityPlacement);
    const byDomainArr = Array.isArray(crossMod.byDomain) ? crossMod.byDomain : [];
    for (const item of byDomainArr) {
      const obj = asObject(item);
      const domain = typeof obj.domain === "string" && PLACEMENT_DOMAINS.includes(obj.domain as PlacementDomain)
        ? (obj.domain as PlacementDomain)
        : null;
      if (!domain) continue;
      const agg = byDomain.get(domain)!;
      const sampleCount = typeof obj.sampleCount === "number" && obj.sampleCount >= 0 ? obj.sampleCount : 0;
      if (sampleCount > 0) agg.placementCount += 1;
      agg.totalSampleCount += sampleCount;
      const conf = asNumber(obj.confidence);
      if (conf !== null) {
        agg.confidenceSum += conf;
        agg.confidenceCount += 1;
      }
      const unc = asNumber(obj.uncertainty);
      if (unc !== null) {
        agg.uncertaintySum += unc;
        agg.uncertaintyCount += 1;
      }
    }
  }

  const byDomainReport = PLACEMENT_DOMAINS.map((domain) => {
    const agg = byDomain.get(domain)!;
    return {
      domain,
      placementCount: agg.placementCount,
      totalSampleCount: agg.totalSampleCount,
      avgConfidence:
        agg.confidenceCount > 0
          ? Number((agg.confidenceSum / agg.confidenceCount).toFixed(6))
          : null,
      avgUncertainty:
        agg.uncertaintyCount > 0
          ? Number((agg.uncertaintySum / agg.uncertaintyCount).toFixed(6))
          : null,
    };
  });

  const report = {
    generatedAt: now.toISOString(),
    contractVersion: PLACEMENT_CONFIDENCE_REPORT_VERSION,
    windowDays,
    totalPlacements: placementRows.length,
    byDomain: byDomainReport,
  };

  return placementConfidenceReportSchema.parse(report);
}
