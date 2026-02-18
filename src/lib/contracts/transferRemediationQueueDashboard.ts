import { z } from "zod";
import { TRANSFER_REMEDIATION_QUEUE_PROTOCOL_VERSION } from "@/lib/ood/transferRemediationQueue";

export const transferRemediationQueueBreakdownRowSchema = z.object({
  key: z.string(),
  count: z.number().int().nonnegative(),
});

export const transferRemediationQueueDashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.literal(TRANSFER_REMEDIATION_QUEUE_PROTOCOL_VERSION),
  windowDays: z.number().int().positive(),
  totalQueueItems: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  scheduledCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  completedOnTimeCount: z.number().int().nonnegative(),
  slaBreachCount: z.number().int().nonnegative(),
  slaOnTimeCompletionRate: z.number().min(0).max(1).nullable(),
  recoveryResolvedCount: z.number().int().nonnegative(),
  recoveryRate: z.number().min(0).max(1).nullable(),
  medianResolutionLatencyHours: z.number().nonnegative().nullable(),
  statusBreakdown: z.array(transferRemediationQueueBreakdownRowSchema),
  reasonBreakdown: z.array(transferRemediationQueueBreakdownRowSchema),
});

export type TransferRemediationQueueDashboard = z.infer<typeof transferRemediationQueueDashboardSchema>;
