import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";
import { getBundleNodeIdsForStage, isPlacementAboveStage } from "@/lib/gse/bundles";
import { mapStageToGseRange } from "@/lib/gse/utils";
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
  req: NextRequest,
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

  const stage = req.nextUrl.searchParams.get("stage") ?? "A1";
  const validStages = ["A1", "A2", "B1", "B2", "C1", "C2"];
  if (!validStages.includes(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const range = mapStageToGseRange(stage);
  const stageCEFR = stage as "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  const [nodes, bundleNodeIds, progress] = await Promise.all([
    prisma.gseNode.findMany({
      where: { gseCenter: { gte: range.min, lte: range.max } },
      select: { nodeId: true, descriptor: true, gseCenter: true },
      orderBy: [{ gseCenter: "asc" }, { nodeId: "asc" }],
    }),
    getBundleNodeIdsForStage(stageCEFR),
    getStudentProgress(studentId),
  ]);
  const bundleSet = new Set(bundleNodeIds);
  const placementStage = (progress as { placementStage?: string }).placementStage as "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | undefined;
  const placementAbove = isPlacementAboveStage(placementStage, stageCEFR);

  const nodeIds = nodes.map((n) => n.nodeId);
  const masteryRows =
    nodeIds.length > 0
      ? await prisma.studentGseMastery.findMany({
          where: { studentId, nodeId: { in: nodeIds } },
          select: {
            nodeId: true,
            masteryScore: true,
            masteryMean: true,
            decayedMastery: true,
            directEvidenceCount: true,
            activationState: true,
          },
        })
      : [];

  const byNode = new Map(masteryRows.map((m) => [m.nodeId, m]));

  const list = nodes.map((node) => {
    const m = byNode.get(node.nodeId);
    const value = m
      ? m.decayedMastery ?? m.masteryMean ?? m.masteryScore
      : 0;
    const direct = m?.directEvidenceCount ?? 0;
    const verified = m?.activationState === "verified";
    const credited =
      (verified && value >= 70) || (placementAbove && value >= 50 && direct >= 1);
    const mastered = value >= 75;
    let status: "mastered" | "credited" | "in_progress" | "no_evidence" =
      "no_evidence";
    if (mastered) status = "mastered";
    else if (credited) status = "credited";
    else if (m) status = "in_progress";

    return {
      nodeId: node.nodeId,
      descriptor: node.descriptor,
      gseCenter: node.gseCenter,
      value: Math.round(value),
      directEvidenceCount: direct,
      activationState: m?.activationState ?? null,
      status,
      inBundle: bundleSet.has(node.nodeId),
    };
  });

  return NextResponse.json({ stage, nodes: list });
}
