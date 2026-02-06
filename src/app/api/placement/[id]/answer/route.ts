import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlacementQuestions, submitPlacementAnswer } from "@/lib/placement";
import { prisma } from "@/lib/db";

type PlacementAnswerContext = {
  params: Promise<{ id: string }>;
};

const schema = z.object({
  questionId: z.string().min(1),
  transcript: z.string().max(1000).optional(),
  selfRating: z.number().int().min(1).max(5).optional(),
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

  try {
    const body = schema.parse(await req.json());
    const updated = await submitPlacementAnswer(id, body);
    const questions = getPlacementQuestions();
    const currentQuestion = questions[updated.currentIndex] || null;

    return NextResponse.json({
      placementId: id,
      status: updated.status,
      currentIndex: updated.currentIndex,
      totalQuestions: questions.length,
      currentQuestion,
      completed: updated.currentIndex >= questions.length,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
