import { z } from "zod";
import { pronunciationDrillPlanSchema } from "@/lib/contracts/pronunciationPinpoint";

export const lessonSessionStatusSchema = z.enum(["active", "completed", "abandoned"]);
export const lessonStepStatusSchema = z.enum(["pending", "active", "passed", "failed", "skipped"]);
export const lessonStepTypeSchema = z.enum(["dialogue", "drill", "transfer", "review"]);
export const lessonTurnRoleSchema = z.enum(["coach", "student"]);
export const lessonTurnModeSchema = z.enum(["voice", "text"]);
export const lessonNextActionSchema = z.enum(["next_turn", "fix_now", "transfer_step", "step_done"]);

export const coverageDebtViewSchema = z.object({
  total: z.number().int().nonnegative(),
  unseen: z.number().int().nonnegative(),
  underTested: z.number().int().nonnegative(),
  severeNodeIds: z.array(z.string()),
  severeDescriptors: z.array(z.string()),
});

export const lessonTaskViewSchema = z.object({
  taskId: z.string(),
  taskType: z.string(),
  prompt: z.string(),
  assessmentMode: z.enum(["pa", "stt", "text"]),
  constraints: z.object({
    minSeconds: z.number().int().positive(),
    maxSeconds: z.number().int().positive(),
  }),
  maxDurationSec: z.number().int().positive(),
  targetNodeIds: z.array(z.string()),
  source: z.string(),
});

export const lessonTurnViewSchema = z.object({
  id: z.string(),
  turnIndex: z.number().int().nonnegative(),
  role: lessonTurnRoleSchema,
  promptText: z.string().nullable(),
  attemptId: z.string().nullable(),
  status: z.string(),
  evaluation: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

export const lessonStepViewSchema = z.object({
  id: z.string(),
  ordinal: z.number().int().nonnegative(),
  stepType: lessonStepTypeSchema,
  status: lessonStepStatusSchema,
  source: z.string(),
  targetNodeIds: z.array(z.string()),
  score: z.number().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  task: lessonTaskViewSchema.nullable(),
  turns: z.array(lessonTurnViewSchema),
  meta: z.record(z.unknown()).nullable(),
});

export const lessonMissionHeaderSchema = z.object({
  title: z.string(),
  goal: z.string(),
  stepLabel: z.string(),
  progressLabel: z.string(),
  primaryCta: z.string(),
  coverageDebt: coverageDebtViewSchema,
});

export const lessonSessionViewSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  classId: z.string(),
  status: lessonSessionStatusSchema,
  mission: z.record(z.unknown()),
  progress: z.record(z.unknown()),
  currentStepIndex: z.number().int().nonnegative(),
  currentTurnIndex: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  steps: z.array(lessonStepViewSchema),
});

export const lessonSummaryViewSchema = z.object({
  sessionId: z.string(),
  status: lessonSessionStatusSchema,
  missionTitle: z.string(),
  goalCoverage: z.object({
    completedSteps: z.number().int().nonnegative(),
    totalSteps: z.number().int().positive(),
    ratio: z.number().min(0).max(1),
  }),
  transfer: z.object({
    required: z.boolean(),
    passed: z.boolean(),
  }),
  corrective: z.object({
    triggeredCount: z.number().int().nonnegative(),
    resolvedCount: z.number().int().nonnegative(),
  }),
  coverageDebt: z.object({
    before: coverageDebtViewSchema,
    after: coverageDebtViewSchema,
  }),
  pronunciationFocus: z.array(z.string()),
  nextFocus: z.array(z.string()),
  generatedAt: z.string().datetime(),
});

export const lessonTurnResultSchema = z.object({
  turnId: z.string(),
  attemptId: z.string().nullable(),
  score: z.number().nullable(),
  pass: z.boolean(),
  pronunciationDrillPlan: pronunciationDrillPlanSchema.nullable(),
});

export type CoverageDebtView = z.infer<typeof coverageDebtViewSchema>;
export type LessonSessionView = z.infer<typeof lessonSessionViewSchema>;
export type LessonStepView = z.infer<typeof lessonStepViewSchema>;
export type LessonTurnView = z.infer<typeof lessonTurnViewSchema>;
export type LessonSummaryView = z.infer<typeof lessonSummaryViewSchema>;
export type LessonMissionHeaderView = z.infer<typeof lessonMissionHeaderSchema>;
export type LessonTurnResultView = z.infer<typeof lessonTurnResultSchema>;
export type LessonNextAction = z.infer<typeof lessonNextActionSchema>;
