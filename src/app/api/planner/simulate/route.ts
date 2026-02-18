import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { planNextTaskDecision } from "@/lib/gse/planner";
import { projectLearnerStageFromGse } from "@/lib/gse/stageProjection";
import { prisma } from "@/lib/db";

const schema = z.object({
  requestedType: z.string().min(2).optional(),
  candidateTaskTypes: z.array(z.string().min(2)).max(10).optional(),
  diagnosticMode: z.boolean().optional(),
});

const DEFAULT_TYPES = [
  "read_aloud",
  "target_vocab",
  "qa_prompt",
  "role_play",
  "topic_talk",
  "filler_control",
  "speech_builder",
];

export async function POST(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const profile = await prisma.learnerProfile.findUnique({
    where: { studentId: student.studentId },
    select: { ageBand: true, coldStartActive: true, placementFresh: true },
  });
  const projection = await projectLearnerStageFromGse(student.studentId);
  const latestCausalDiagnosis = await prisma.causalDiagnosis.findFirst({
    where: { studentId: student.studentId },
    orderBy: { createdAt: "desc" },
    select: {
      attemptId: true,
      modelVersion: true,
      topLabel: true,
      entropy: true,
      topMargin: true,
      distributionJson: true,
    },
  });
  const decision = await planNextTaskDecision({
    studentId: student.studentId,
    stage: projection.promotionStage,
    ageBand: profile?.ageBand || "9-11",
    candidateTaskTypes:
      body.data.candidateTaskTypes && body.data.candidateTaskTypes.length > 0
        ? body.data.candidateTaskTypes
        : DEFAULT_TYPES,
    requestedType: body.data.requestedType || null,
    diagnosticMode:
      typeof body.data.diagnosticMode === "boolean"
        ? body.data.diagnosticMode
        : Boolean(profile?.coldStartActive) || Boolean(profile?.placementFresh),
    causalSnapshot: latestCausalDiagnosis
      ? {
          attemptId: latestCausalDiagnosis.attemptId,
          modelVersion: latestCausalDiagnosis.modelVersion,
          topLabel: latestCausalDiagnosis.topLabel,
          entropy: latestCausalDiagnosis.entropy,
          topMargin: latestCausalDiagnosis.topMargin,
          distributionJson: latestCausalDiagnosis.distributionJson,
        }
      : null,
  });

  return NextResponse.json({
    stage: projection.promotionStage,
    placementStage: projection.placementStage,
    decisionId: decision.decisionId,
    chosenTaskType: decision.chosenTaskType,
    expectedGain: decision.expectedGain,
    targetNodeIds: decision.targetNodeIds,
    targetNodeDescriptors: decision.targetNodeDescriptors,
    domainsTargeted: decision.domainsTargeted,
    diagnosticMode: decision.diagnosticMode,
    primaryGoal: decision.primaryGoal,
    candidateScores: decision.candidateScores,
    ambiguityTrigger: decision.ambiguityTrigger,
  });
}
