import { z } from "zod";
import { DISCOURSE_PRAGMATICS_VERSION } from "@/lib/discourse/pragmatics";

export const DISCOURSE_PRAGMATICS_BENCHMARK_VERSION =
  "discourse-pragmatics-benchmark-v1" as const;

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);

const discourseDimensionSchema = z.enum([
  "argumentStructure",
  "registerControl",
  "turnTakingRepair",
  "cohesion",
  "audienceFit",
]);

export const discoursePragmaticsDimensionRowSchema = z.object({
  dimension: discourseDimensionSchema,
  coverageCount: nonNegativeInt,
  enginePassRate: boundedRate.nullable(),
  adjudicatedPassRate: boundedRate.nullable(),
  agreementRate: boundedRate.nullable(),
  meanAbsoluteError: z.number().nonnegative().nullable(),
});

export const discoursePragmaticsTaskTypeRowSchema = z.object({
  taskType: z.string(),
  count: nonNegativeInt,
  agreementRate: boundedRate.nullable(),
});

export const discoursePragmaticsBenchmarkReportSchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(DISCOURSE_PRAGMATICS_BENCHMARK_VERSION),
  engineVersion: z.literal(DISCOURSE_PRAGMATICS_VERSION),
  windowDays: z.number().int().positive(),
  totalAttempts: nonNegativeInt,
  discourseAttempts: nonNegativeInt,
  engineCoverageCount: nonNegativeInt,
  engineCoverageRate: boundedRate.nullable(),
  overallAgreementRate: boundedRate.nullable(),
  dimensions: z.array(discoursePragmaticsDimensionRowSchema),
  byTaskType: z.array(discoursePragmaticsTaskTypeRowSchema),
});

export type DiscoursePragmaticsBenchmarkReport = z.infer<
  typeof discoursePragmaticsBenchmarkReportSchema
>;
