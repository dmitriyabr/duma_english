import { z } from "zod";

export const PLACEMENT_CONFIDENCE_REPORT_VERSION =
  "placement-confidence-report-v1" as const;

const PLACEMENT_DOMAINS = [
  "speaking",
  "listening",
  "reading",
  "writing",
  "grammar",
  "vocabulary",
] as const;
const domainSchema = z.enum(PLACEMENT_DOMAINS);
const boundedRate = z.number().min(0).max(1);

export const placementConfidenceByDomainRowSchema = z.object({
  domain: domainSchema,
  placementCount: z.number().int().nonnegative(),
  totalSampleCount: z.number().int().nonnegative(),
  avgConfidence: z.number().min(0).max(1).nullable(),
  avgUncertainty: z.number().min(0).max(1).nullable(),
});

export const placementConfidenceReportSchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(PLACEMENT_CONFIDENCE_REPORT_VERSION),
  windowDays: z.number().int().positive(),
  totalPlacements: z.number().int().nonnegative(),
  byDomain: z.array(placementConfidenceByDomainRowSchema),
});

export type PlacementConfidenceByDomainRow = z.infer<
  typeof placementConfidenceByDomainRowSchema
>;
export type PlacementConfidenceReport = z.infer<
  typeof placementConfidenceReportSchema
>;
