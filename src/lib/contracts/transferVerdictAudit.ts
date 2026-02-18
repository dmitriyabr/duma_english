import { z } from "zod";
import { TRANSFER_VERDICT_PROTOCOL_VERSION } from "@/lib/ood/transferVerdict";

export const transferVerdictBreakdownRowSchema = z.object({
  verdict: z.string(),
  count: z.number().int().nonnegative(),
});

export const transferVerdictAxisBreakdownRowSchema = z.object({
  axisTag: z.string(),
  count: z.number().int().nonnegative(),
});

export const transferVerdictAuditReportSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.literal(TRANSFER_VERDICT_PROTOCOL_VERSION),
  windowDays: z.number().int().positive(),
  totalOodSpecs: z.number().int().nonnegative(),
  evaluatedOodSpecs: z.number().int().nonnegative(),
  pendingOodSpecs: z.number().int().nonnegative(),
  transferPassCount: z.number().int().nonnegative(),
  candidateTransferFailCount: z.number().int().nonnegative(),
  validatedTransferFailCount: z.number().int().nonnegative(),
  unvalidatedTransferFailCount: z.number().int().nonnegative(),
  inconclusiveCount: z.number().int().nonnegative(),
  protocolViolationCount: z.number().int().nonnegative(),
  matchedControlPassRate: z.number().min(0).max(1).nullable(),
  verdictBreakdown: z.array(transferVerdictBreakdownRowSchema),
  axisBreakdown: z.array(transferVerdictAxisBreakdownRowSchema),
});

export type TransferVerdictAuditReport = z.infer<typeof transferVerdictAuditReportSchema>;
