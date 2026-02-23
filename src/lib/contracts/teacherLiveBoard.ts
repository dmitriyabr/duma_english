import { z } from "zod";

export const teacherLiveBoardStatusSchema = z.enum([
  "in_progress",
  "stuck",
  "retry_loop",
  "completed",
]);

export const teacherLiveBoardRowSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  lessonSessionId: z.string().nullable(),
  status: teacherLiveBoardStatusSchema,
  stepType: z.string().nullable(),
  stepOrdinal: z.number().int().nullable(),
  stepEtaMin: z.number().int().nullable(),
  blockerLabel: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
});

export const teacherLiveBoardResponseSchema = z.object({
  classId: z.string(),
  generatedAt: z.string().datetime(),
  rows: z.array(teacherLiveBoardRowSchema),
});

export type TeacherLiveBoardRow = z.infer<typeof teacherLiveBoardRowSchema>;
export type TeacherLiveBoardResponse = z.infer<typeof teacherLiveBoardResponseSchema>;
