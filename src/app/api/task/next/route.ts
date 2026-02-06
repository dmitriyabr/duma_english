import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { buildTaskTemplate } from "@/lib/taskTemplates";
import { buildLearningPlan } from "@/lib/adaptive";

export async function GET(req: Request) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const requestedType = url.searchParams.get("type");
  const learningPlan = await buildLearningPlan({
    studentId: student.studentId,
    requestedType,
  });
  const selectedTaskType = learningPlan.recommendedTaskTypes[0] || "topic_talk";
  const template = buildTaskTemplate(selectedTaskType, {
    targetWords: learningPlan.targetWords,
    stage: learningPlan.currentStage,
    reason: learningPlan.nextTaskReason,
    focusSkills: learningPlan.weakestSkills,
  });
  const task = await prisma.task.create({
    data: {
      type: template.type,
      prompt: template.prompt,
      level: template.level,
      metaJson: (template.meta || {}) as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    taskId: task.id,
    type: task.type,
    prompt: task.prompt,
    assessmentMode: template.assessmentMode,
    maxDurationSec: template.maxDurationSec,
    constraints: template.constraints,
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    reason: learningPlan.nextTaskReason,
    targetSkills: learningPlan.weakestSkills,
    targetWords: learningPlan.targetWords,
    recommendedTaskTypes: learningPlan.recommendedTaskTypes,
  });
}
