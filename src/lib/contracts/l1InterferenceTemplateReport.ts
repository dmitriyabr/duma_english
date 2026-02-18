import { z } from "zod";
import { L1_INTERFERENCE_PRIOR_VERSION } from "@/lib/localization/interferencePrior";

const nonNegativeInt = z.number().int().nonnegative();
const rate = z.number().min(0).max(1);

const countRowSchema = z.object({
  key: z.string(),
  count: nonNegativeInt,
});

export const l1CauseTemplateMappingRowSchema = z.object({
  causeLabel: z.string(),
  templateKey: z.string(),
  count: nonNegativeInt,
});

export const l1TemplateBreakdownRowSchema = z.object({
  templateKey: z.string(),
  templateTitle: z.string(),
  count: nonNegativeInt,
});

export const l1InterferenceTemplateReportSchema = z.object({
  generatedAt: z.string().datetime(),
  priorVersion: z.literal(L1_INTERFERENCE_PRIOR_VERSION),
  windowDays: z.number().int().positive(),
  totalDecisionLogs: nonNegativeInt,
  causalRemediationEvaluatedCount: nonNegativeInt,
  l1TopCauseCount: nonNegativeInt,
  templatedL1Count: nonNegativeInt,
  missingTemplateForL1Count: nonNegativeInt,
  templatedL1Rate: rate.nullable(),
  ageBandBreakdown: z.array(countRowSchema),
  domainBreakdown: z.array(countRowSchema),
  templateBreakdown: z.array(l1TemplateBreakdownRowSchema),
  causeTemplateMappings: z.array(l1CauseTemplateMappingRowSchema),
});

export type L1InterferenceTemplateReport = z.infer<
  typeof l1InterferenceTemplateReportSchema
>;
