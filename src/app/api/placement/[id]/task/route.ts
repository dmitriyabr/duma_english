import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlacementSession } from "@/lib/placement";
import { prisma } from "@/lib/db";

type PlacementTaskRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: PlacementTaskRouteContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await getPlacementSession(student.studentId, id);
  if (!state) {
    return NextResponse.json({ error: "Placement session not found" }, { status: 404 });
  }
  if (state.session.status !== "started" || !state.question) {
    return NextResponse.json({ error: "Placement already completed" }, { status: 409 });
  }

  const question = state.question;
  const task = await prisma.task.create({
    data: {
      type: question.taskType,
      prompt: question.prompt,
      level: 1,
      metaJson: {
        placementSessionId: state.session.id,
        placementQuestionId: question.id,
        placementSkillKey: question.skillKey,
        isPlacement: true,
        supportsPronAssessment: question.assessmentMode === "pa",
        maxDurationSec: question.maxDurationSec,
        ...(question.meta || {}),
      } as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    placementId: state.session.id,
    taskId: task.id,
    type: task.type,
    prompt: task.prompt,
    assessmentMode: question.assessmentMode,
    maxDurationSec: question.maxDurationSec,
    constraints: {
      minSeconds: 8,
      maxSeconds: question.maxDurationSec,
    },
    placement: {
      questionId: question.id,
      skillKey: question.skillKey,
      currentIndex: state.session.currentIndex,
      totalQuestions: state.totalQuestions,
    },
  });
}
