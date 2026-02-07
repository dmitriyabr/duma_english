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

  const recentAttempts = await prisma.attempt.findMany({
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
  });

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
  });
}
