import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";
import { ensureLearnerProfile } from "@/lib/adaptive";
import { getStudentProgress } from "@/lib/progress";

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
  };
  const recentNodeOutcomes: Array<{
    descriptor: string;
    nodeId: string;
    deltaMastery: number;
    decayImpact: number;
    previousMean?: number;
    nextMean?: number;
    attemptCreatedAt: string;
  }> = [];
  const nodeIdsFromOutcomes = new Set<string>();
  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    for (const o of outcomes) nodeIdsFromOutcomes.add(o.nodeId);
  }
  const nodeIdToDescriptor =
    nodeIdsFromOutcomes.size > 0
      ? await prisma.gseNode
          .findMany({
            where: { nodeId: { in: Array.from(nodeIdsFromOutcomes) } },
            select: { nodeId: true, descriptor: true },
          })
          .then((rows) => new Map(rows.map((r) => [r.nodeId, r.descriptor])))
      : new Map<string, string>();

  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    const attemptDate = a.createdAt.toISOString();
    for (const o of outcomes) {
      recentNodeOutcomes.push({
        descriptor: nodeIdToDescriptor.get(o.nodeId) ?? o.nodeId,
        nodeId: o.nodeId,
        deltaMastery: o.deltaMastery,
        decayImpact: o.decayImpact,
        previousMean: o.previousMean,
        nextMean: o.nextMean,
        attemptCreatedAt: attemptDate,
      });
    }
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
