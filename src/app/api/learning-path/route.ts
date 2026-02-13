import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { nextTargetNodesForStudent } from "@/lib/gse/planner";
import { projectLearnerStageFromGse } from "@/lib/gse/stageProjection";
import { prisma } from "@/lib/db";

const RECOMMENDED_TASK_TYPES = [
  "read_aloud",
  "target_vocab",
  "qa_prompt",
  "role_play",
  "topic_talk",
  "filler_control",
  "speech_builder",
];

export async function GET() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projection = await projectLearnerStageFromGse(student.studentId);
  const nextTargets = await nextTargetNodesForStudent(student.studentId, 6);
  const targetWords = await prisma.studentVocabulary.findMany({
    where: {
      studentId: student.studentId,
      OR: [{ status: "new" }, { status: "learning", nextReviewAt: { lte: new Date() } }],
    },
    orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "asc" }],
    take: 6,
    select: { lemma: true },
  });
  const weakestSkills = projection.derivedSkills
    .filter((item) => item.current !== null)
    .sort((a, b) => (a.current ?? 0) - (b.current ?? 0))
    .slice(0, 2)
    .map((item) => item.skillKey);

  return NextResponse.json({
    studentId: student.studentId,
    stage: projection.promotionStage,
    placementStage: projection.placementStage,
    promotionStage: projection.promotionStage,
    placementConfidence: projection.placementConfidence,
    placementUncertainty: projection.placementUncertainty,
    domainStages: projection.domainStages,
    pronunciationScore: projection.pronunciationScore,
    placement: {
      diagnosticMode: true,
      provisionalStage: projection.placementStage,
      promotionStage: projection.promotionStage,
    },
    weakestSkills,
    targetWords: targetWords.map((row) => row.lemma.toLowerCase()),
    recommendedTaskTypes: RECOMMENDED_TASK_TYPES,
    nextTaskReason:
      nextTargets[0]?.descriptor || "Collect more evidence on weak and uncertain GSE nodes.",
    nextTargetNodes: nextTargets,
    mastery: projection.derivedSkills.map((row) => ({
      skillKey: row.skillKey,
      masteryScore: row.current,
      reliability: row.reliability,
      evidenceCount: row.sampleCount,
      source: row.source,
    })),
  });
}
