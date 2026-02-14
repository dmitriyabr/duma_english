import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlacementSession } from "@/lib/placement/irt";
import { prisma } from "@/lib/db";
import { generateTaskSpec } from "@/lib/taskGenerator";
import { buildTaskTemplate } from "@/lib/taskTemplates";
import { extractReferenceText, extractRequiredWords } from "@/lib/taskText";

type PlacementTaskRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: PlacementTaskRouteContext) {
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

  return NextResponse.json({
    placementId: state.session.id,
    status: state.session.status,
    theta: state.session.theta,
    sigma: state.session.sigma,
    questionCount: state.session.questionCount,
    totalQuestions: state.totalQuestions,
    nextItem: state.question,
    whyThisItem: "Selected to maximize information near current ability estimate.",
  });
}

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
  const profile = await prisma.learnerProfile.findUnique({
    where: { studentId: student.studentId },
    select: { ageBand: true },
  });
  const basePromptWords =
    question.taskType === "target_vocab" ? extractRequiredWords(question.prompt) : [];
  const generated = await generateTaskSpec({
    taskType: question.taskType,
    stage: question.stageBand,
    ageBand: profile?.ageBand || "9-11",
    targetWords: basePromptWords,
    targetNodeIds: question.gseTargets || [],
    focusSkills: [question.skillKey],
    plannerReason: "Placement calibration step",
    primaryGoal: "placement_measurement",
  });
  let prompt = generated.prompt || question.prompt;
  const referenceText =
    question.taskType === "read_aloud"
      ? extractReferenceText(prompt) || extractReferenceText(question.prompt)
      : null;
  if (question.taskType === "read_aloud" && !referenceText) {
    prompt = buildTaskTemplate("read_aloud", {
      stage: question.stageBand,
      reason: "Placement calibration step",
      focusSkills: [question.skillKey],
    }).prompt;
  }
  const effectiveReferenceText =
    question.taskType === "read_aloud"
      ? extractReferenceText(prompt) || extractReferenceText(question.prompt)
      : null;
  const requiredWords =
    question.taskType === "target_vocab"
      ? (() => {
          const fromPrompt = extractRequiredWords(prompt);
          return fromPrompt.length > 0 ? fromPrompt : basePromptWords;
        })()
      : [];
  const effectiveAssessmentMode = question.assessmentMode;
  const effectiveConstraints = {
    minSeconds: Math.max(5, Math.min(question.maxDurationSec, generated.constraints?.minSeconds || 8)),
    maxSeconds: Math.max(
      10,
      Math.min(
        question.maxDurationSec,
        Math.max(generated.constraints?.maxSeconds || question.maxDurationSec, generated.constraints?.minSeconds || 8)
      )
    ),
  };
  const task = await prisma.task.create({
    data: {
      type: question.taskType,
      prompt,
      level: Math.max(1, Math.round((generated.estimatedDifficulty || question.difficulty || 40) / 20)),
      metaJson: {
        placementSessionId: state.session.id,
        placementItemId: question.id,
        placementSkillKey: question.skillKey,
        isPlacement: true,
        supportsPronAssessment: effectiveAssessmentMode === "pa",
        assessmentMode: effectiveAssessmentMode,
        referenceText: effectiveReferenceText,
        requiredWords: requiredWords.length > 0 ? requiredWords : undefined,
        maxDurationSec: question.maxDurationSec,
        gseTargets: question.gseTargets,
        stageBand: question.stageBand,
        generation: {
          fallbackUsed: generated.fallbackUsed,
          fallbackReason: generated.fallbackReason || null,
        },
      } as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    placementId: state.session.id,
    taskId: task.id,
    type: task.type,
    prompt: task.prompt,
    assessmentMode: effectiveAssessmentMode,
    maxDurationSec: question.maxDurationSec,
    constraints: effectiveConstraints,
    placement: {
      itemId: question.id,
      skillKey: question.skillKey,
      currentIndex: state.session.currentIndex,
      totalQuestions: state.totalQuestions,
      theta: state.session.theta,
      sigma: state.session.sigma,
    },
  });
}
