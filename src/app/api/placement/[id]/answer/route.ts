import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { submitPlacementAnswer } from "@/lib/placement/irt";
import { isPlacementSessionActive } from "@/lib/placement/shared";
import type { PlacementSessionStatus } from "@/lib/placement/types";
import { prisma } from "@/lib/db";

type PlacementAnswerContext = {
  params: Promise<{ id: string }>;
};

const schema = z.object({
  itemId: z.string().min(1).optional(),
  questionId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(),
  transcript: z.string().max(1000).optional(),
  selfRating: z.number().int().min(1).max(5).optional(),
  observedMetrics: z
    .object({
      speechScore: z.number().optional(),
      taskScore: z.number().optional(),
      languageScore: z.number().optional(),
      speechRate: z.number().optional(),
      pronunciation: z.number().optional(),
      fluency: z.number().optional(),
      vocabularyUsage: z.number().optional(),
      taskCompletion: z.number().optional(),
      grammarAccuracy: z.number().optional(),
    })
    .partial()
    .optional(),
});

export async function POST(req: NextRequest, context: PlacementAnswerContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await prisma.placementSession.findUnique({ where: { id } });
  if (!session || session.studentId !== student.studentId) {
    return NextResponse.json({ error: "Placement session not found" }, { status: 404 });
  }
  if (!isPlacementSessionActive(session.status as PlacementSessionStatus)) {
    return NextResponse.json({ error: "Placement session is not active" }, { status: 409 });
  }

  try {
    const body = schema.parse(await req.json());
    const updated = await submitPlacementAnswer(id, body);

    return NextResponse.json({
      placementId: id,
      status: updated.status,
      theta: updated.theta,
      sigma: updated.sigma,
      currentIndex: updated.currentIndex,
      questionCount: updated.questionCount,
      totalQuestions: 14,
      nextItem: updated.nextItem,
      whyThisItem: updated.whyThisItem,
      done: updated.done,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
