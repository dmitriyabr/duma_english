import { z } from "zod";

export const pronunciationIssueSchema = z.object({
  id: z.string(),
  label: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  hint: z.string(),
  cue: z.string(),
});

export const pronunciationDrillPlanSchema = z.object({
  focus: z.string(),
  issues: z.array(pronunciationIssueSchema).max(4),
  microDrillLines: z.array(z.string()).max(6),
  replayCount: z.number().int().min(1).max(6),
});

export type PronunciationIssue = z.infer<typeof pronunciationIssueSchema>;
export type PronunciationDrillPlan = z.infer<typeof pronunciationDrillPlanSchema>;
