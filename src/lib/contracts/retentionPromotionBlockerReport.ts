import { z } from "zod";
import { RETENTION_PROMOTION_GATE_VERSION } from "@/lib/retention/promotionGate";

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);

export const retentionPromotionReasonRowSchema = z.object({
  key: z.string(),
  count: nonNegativeInt,
});

export const retentionPromotionTransitionRowSchema = z.object({
  fromStage: z.string(),
  toStage: z.string(),
  count: nonNegativeInt,
  blockedByRetentionCount: nonNegativeInt,
});

export const retentionPromotionBlockerReportSchema = z.object({
  generatedAt: z.string().datetime(),
  gateVersion: z.literal(RETENTION_PROMOTION_GATE_VERSION),
  windowDays: z.number().int().positive(),
  totalAudits: nonNegativeInt,
  promotedCount: nonNegativeInt,
  blockedCount: nonNegativeInt,
  blockedByRetentionCount: nonNegativeInt,
  blockedByRetentionRate: boundedRate.nullable(),
  highStakesAuditCount: nonNegativeInt,
  highStakesRetentionBlockedCount: nonNegativeInt,
  highStakesRetentionBlockedRate: boundedRate.nullable(),
  missingRetentionGateContextCount: nonNegativeInt,
  reasonBreakdown: z.array(retentionPromotionReasonRowSchema),
  transitionBreakdown: z.array(retentionPromotionTransitionRowSchema),
});

export type RetentionPromotionBlockerReport = z.infer<
  typeof retentionPromotionBlockerReportSchema
>;
