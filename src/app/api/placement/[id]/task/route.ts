import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlacementSession } from "@/lib/placement";
import { prisma } from "@/lib/db";
import { generateTaskSpec } from "@/lib/taskGenerator";

type PlacementTaskRouteContext = {
  params: Promise<{ id: string }>;
};

function inferReferenceText(prompt: string) {
  const text = (prompt || "").trim();
  if (!text) return "";
  const quoted = text.match(/['"]([^'"]{3,260})['"]/);
  if (quoted && quoted[1]) return quoted[1].trim();
  const afterColon = text.split(":").slice(1).join(":").trim();
  if (afterColon.length >= 3) return afterColon;
  return text;
}

function inferTargetWords(prompt: string) {
  const text = (prompt || "").trim();
  const match = text.match(
    /use\s+(?:these|those|the)\s+words(?:\s+in\s+(?:your\s+)?(?:short\s+)?(?:talk|answer))?\s*:?\s*([^.\n]+)/i
  );
  const source = match?.[1] || "";
  if (!source) return [] as string[];
  return source
    .split(/,|\band\b/i)
    .map((word) =>
      word
        .trim()
        .toLowerCase()
        .replace(/["'.!?;:()[\]{}]/g, "")
    )
    .filter((word) => /^[a-z][a-z'-]*$/.test(word))
    .slice(0, 20);
}

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
    question.taskType === "target_vocab" ? inferTargetWords(question.prompt) : [];
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
  const prompt = generated.prompt || question.prompt;
  const referenceText =
    question.taskType === "read_aloud"
      ? inferReferenceText(prompt) || inferReferenceText(question.prompt)
      : null;
  const requiredWords =
    question.taskType === "target_vocab"
      ? (() => {
          const fromPrompt = inferTargetWords(prompt);
          return fromPrompt.length > 0 ? fromPrompt : basePromptWords;
        })()
      : [];
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
        supportsPronAssessment: question.assessmentMode === "pa",
        referenceText,
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
    assessmentMode: generated.assessmentMode || question.assessmentMode,
    maxDurationSec: question.maxDurationSec,
    constraints: {
      minSeconds: generated.constraints?.minSeconds || 8,
      maxSeconds: Math.min(question.maxDurationSec, generated.constraints?.maxSeconds || question.maxDurationSec),
    },
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
