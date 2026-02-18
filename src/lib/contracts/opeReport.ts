import { z } from "zod";

export const opeBreakdownRowSchema = z.object({
  key: z.string(),
  count: z.number().int().nonnegative(),
});

export const opeMetricsSchema = z.object({
  baselineValue: z.number().min(0).max(1).nullable(),
  targetPolicyValue: z.number().min(0).max(1).nullable(),
  lift: z.number().nullable(),
  ciLower: z.number().nullable(),
  ciUpper: z.number().nullable(),
  effectiveSampleSize: z.number().nonnegative().nullable(),
  targetMatchRate: z.number().min(0).max(1).nullable(),
});

export const opeReportSchema = z.object({
  generatedAt: z.string().datetime(),
  policyVersion: z.literal("ope-snips-v1"),
  windowDays: z.number().int().positive(),
  totalRows: z.number().int().nonnegative(),
  completeRows: z.number().int().nonnegative(),
  excludedRows: z.number().int().nonnegative(),
  incompleteRate: z.number().min(0).max(1),
  bootstrapSamples: z.number().int().nonnegative(),
  validBootstrapSamples: z.number().int().nonnegative(),
  exclusionReasons: z.array(opeBreakdownRowSchema),
  policyVersions: z.array(opeBreakdownRowSchema),
  metrics: opeMetricsSchema,
});

export type OpeReport = z.infer<typeof opeReportSchema>;
