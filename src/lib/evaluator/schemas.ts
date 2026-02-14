import { z } from "zod";

export const rubricCheckSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  reason: z.string(),
  weight: z.number().min(0).max(1),
});

export const feedbackResultSchema = z.object({
  summary: z.string(),
  whatWentWell: z.array(z.string()),
  whatToFixNow: z.array(z.string()),
  exampleBetterAnswer: z.string(),
  nextMicroTask: z.string(),
});

export const taskEvaluationSchema = z.object({
  taskType: z.string(),
  taskScore: z.number().min(0).max(100),
  languageScore: z.number().min(0).max(100).optional(),
  artifacts: z.record(z.unknown()),
  rubricChecks: z.array(rubricCheckSchema),
  loChecks: z.array(z.unknown()),
  grammarChecks: z.array(z.unknown()),
  vocabChecks: z.array(z.unknown()),
  evidence: z.array(z.string()),
  modelVersion: z.string(),
});
