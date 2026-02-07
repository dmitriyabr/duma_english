import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";
import { ensureLearnerProfile } from "@/lib/adaptive";
import { getStudentProgress } from "@/lib/progress";
import { computeStageBundleReadiness } from "@/lib/gse/bundles";
import { mapStageToGseRange } from "@/lib/gse/utils";

async function ensureTeacherCanAccessStudent(
  teacherId: string,
  studentId: string
) {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    include: {
      class: { select: { id: true, name: true, teacherId: true } },
    },
  });
  if (!student || student.class.teacherId !== teacherId) return null;
  return student;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { studentId } = await params;
  const student = await ensureTeacherCanAccessStudent(
    teacher.teacherId,
    studentId
  );
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  await ensureLearnerProfile(studentId);
  const progress = await getStudentProgress(studentId);

  const [recentAttempts, fullMasteryRows, attemptsWithOutcomes] = await Promise.all([
    prisma.attempt.findMany({
      where: { studentId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
        scoresJson: true,
        task: {
          select: { type: true, prompt: true },
        },
      },
    }),
    prisma.studentGseMastery.findMany({
      where: { studentId },
      include: {
        node: {
          select: {
            nodeId: true,
            descriptor: true,
            type: true,
            skill: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 400,
    }),
    prisma.attempt.findMany({
      where: { studentId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, createdAt: true, nodeOutcomesJson: true },
    }),
  ]);

  const fullMastery = fullMasteryRows.map((m) => ({
    nodeId: m.nodeId,
    descriptor: m.node.descriptor,
    type: m.node.type,
    skill: m.node.skill,
    masteryScore: m.masteryScore,
    decayedMastery: m.decayedMastery ?? m.masteryMean ?? m.masteryScore,
    evidenceCount: m.evidenceCount,
    directEvidenceCount: m.directEvidenceCount,
    activationState: m.activationState,
    lastEvidenceAt: m.lastEvidenceAt,
    updatedAt: m.updatedAt,
    halfLifeDays: m.halfLifeDays,
    masterySigma: m.masterySigma,
  }));

  type NodeOutcome = {
    nodeId: string;
    deltaMastery: number;
    decayImpact: number;
    previousMean?: number;
    nextMean?: number;
    reliability?: string;
    evidenceCount?: number;
    streakMultiplier?: number;
  };
  const recentNodeOutcomes: Array<{
    descriptor: string;
    nodeId: string;
    stage: string;
    deltaMastery: number;
    decayImpact: number;
    previousMean?: number;
    nextMean?: number;
    attemptCreatedAt: string;
    streakMultiplier?: number;
  }> = [];
  const nodeIdsFromOutcomes = new Set<string>();
  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    for (const o of outcomes) nodeIdsFromOutcomes.add(o.nodeId);
  }
  function gseBandFromCenter(value: number | null | undefined): string {
    if (typeof value !== "number") return "A0";
    if (value <= 29) return "A1";
    if (value <= 42) return "A2";
    if (value <= 58) return "B1";
    if (value <= 75) return "B2";
    if (value <= 84) return "C1";
    return "C2";
  }

  const nodeIdToInfo =
    nodeIdsFromOutcomes.size > 0
      ? await prisma.gseNode
          .findMany({
            where: { nodeId: { in: Array.from(nodeIdsFromOutcomes) } },
            select: { nodeId: true, descriptor: true, gseCenter: true },
          })
          .then((rows) =>
            new Map(rows.map((r) => [r.nodeId, { descriptor: r.descriptor, stage: gseBandFromCenter(r.gseCenter) }]))
          )
      : new Map<string, { descriptor: string; stage: string }>();

  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    const attemptDate = a.createdAt.toISOString();
    for (const o of outcomes) {
      const info = nodeIdToInfo.get(o.nodeId);
      recentNodeOutcomes.push({
        descriptor: info?.descriptor ?? o.nodeId,
        nodeId: o.nodeId,
        stage: info?.stage ?? "A0",
        deltaMastery: o.deltaMastery,
        decayImpact: o.decayImpact,
        previousMean: o.previousMean,
        nextMean: o.nextMean,
        attemptCreatedAt: attemptDate,
        ...(typeof o.streakMultiplier === "number" && { streakMultiplier: o.streakMultiplier }),
      });
    }
  }

  const STAGES = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
  const placementStage = (progress as { placementStage?: string }).placementStage;
  const [catalogNodesByBand, bundleReadiness] = await Promise.all([
    Promise.all(
      STAGES.map(async (stage) => {
        const range = mapStageToGseRange(stage);
        const count = await prisma.gseNode.count({
          where: { gseCenter: { gte: range.min, lte: range.max } },
        });
        return [stage, count] as const;
      })
    ).then((pairs) => Object.fromEntries(pairs)),
    computeStageBundleReadiness(studentId, placementStage as "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | undefined),
  ]);

  const perStageCredited: Record<string, number> = {};
  for (const row of bundleReadiness.stageRows) {
    perStageCredited[row.stage] = row.bundleRows.reduce((sum, b) => sum + b.coveredCount, 0);
  }

  return NextResponse.json({
    student: {
      id: student.id,
      displayName: student.displayName,
      createdAt: student.createdAt,
      classId: student.classId,
      className: student.class.name,
    },
    progress,
    catalogNodesByBand,
    perStageCredited,
    recentAttempts: recentAttempts.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
      scores: a.scoresJson,
      taskType: a.task.type,
      promptPreview: a.task.prompt?.slice(0, 120),
    })),
    fullMastery,
    recentNodeOutcomes: recentNodeOutcomes.slice(0, 80),
  });
}
