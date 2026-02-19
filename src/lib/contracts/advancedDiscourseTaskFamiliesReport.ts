import { z } from "zod";

export const ADVANCED_DISCOURSE_TASK_FAMILIES_REPORT_VERSION =
  "advanced-discourse-task-families-report-v1" as const;

export const BASELINE_TASK_FAMILIES_PRE_CH35 = [
  "read_aloud",
  "target_vocab",
  "qa_prompt",
  "role_play",
  "topic_talk",
  "filler_control",
  "speech_builder",
] as const;

export const ADVANCED_DISCOURSE_TASK_FAMILIES = [
  "argumentation",
  "register_switch",
  "misunderstanding_repair",
] as const;

const nonNegativeInt = z.number().int().nonnegative();
const boundedRate = z.number().min(0).max(1);

export const taskFamilyCatalogRowSchema = z.object({
  taskType: z.string().min(2),
  classification: z.enum(["baseline", "advanced_discourse", "other"]),
  fromTemplateCatalog: z.boolean(),
  supportsDiscoursePragmatics: z.boolean(),
  stageCoverage: z.array(z.string().min(2)).min(1),
});

export const taskFamilyPassRateRowSchema = z.object({
  taskType: z.string().min(2),
  attempts: nonNegativeInt,
  passedAttempts: nonNegativeInt,
  passRate: boundedRate.nullable(),
});

export const advancedDiscourseTaskFamiliesReportSchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(ADVANCED_DISCOURSE_TASK_FAMILIES_REPORT_VERSION),
  windowDays: z.number().int().positive(),
  baselineTaskFamilies: z.array(z.string().min(2)).min(1),
  currentTaskFamilies: z.array(z.string().min(2)).min(1),
  addedTaskFamilies: z.array(z.string().min(2)),
  removedTaskFamilies: z.array(z.string().min(2)),
  catalogRows: z.array(taskFamilyCatalogRowSchema).min(1),
  passRateByTaskFamily: z.array(taskFamilyPassRateRowSchema).min(1),
  totals: z.object({
    attemptsConsidered: nonNegativeInt,
    scoredAttempts: nonNegativeInt,
  }),
});

export type AdvancedDiscourseTaskFamiliesReport = z.infer<
  typeof advancedDiscourseTaskFamiliesReportSchema
>;
