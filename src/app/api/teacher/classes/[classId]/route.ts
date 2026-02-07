import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";
import { getStudentProgress } from "@/lib/progress";

async function ensureTeacherClass(teacherId: string, classId: string) {
  const cls = await prisma.class.findFirst({
    where: { id: classId, teacherId },
    include: {
      codes: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
      },
      students: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          displayName: true,
          createdAt: true,
          loginCode: true,
        },
      },
    },
  });
  return cls;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { classId } = await params;
  const cls = await ensureTeacherClass(teacher.teacherId, classId);
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const lastAttempts = await prisma.attempt.findMany({
    where: { studentId: { in: cls.students.map((s) => s.id) }, status: "completed" },
    select: { studentId: true, createdAt: true, scoresJson: true },
    orderBy: { createdAt: "desc" },
  });

  const byStudent = new Map<
    string,
    { lastAttemptAt: Date; lastScore?: number }
  >();
  for (const a of lastAttempts) {
    if (!byStudent.has(a.studentId)) {
      const scores = a.scoresJson as { overallScore?: number } | null;
      byStudent.set(a.studentId, {
        lastAttemptAt: a.createdAt,
        lastScore: scores?.overallScore,
      });
    }
  }

  const stageByStudent = new Map<string, string>();
  for (const s of cls.students) {
    try {
      const progress = await getStudentProgress(s.id);
      stageByStudent.set(s.id, progress.stage ?? "—");
    } catch {
      stageByStudent.set(s.id, "—");
    }
  }

  const students = cls.students.map((s) => {
    const last = byStudent.get(s.id);
    const stage = stageByStudent.get(s.id) ?? "—";
    return {
      id: s.id,
      displayName: s.displayName,
      createdAt: s.createdAt,
      loginCode: s.loginCode ?? null,
      lastAttemptAt: last?.lastAttemptAt ?? null,
      lastScore: last?.lastScore ?? null,
      stage,
    };
  });

  const codes = cls.codes.map((c) => ({
    id: c.id,
    code: c.code,
    expiresAt: c.expiresAt,
    usesCount: c.usesCount,
    maxUses: c.maxUses,
  }));

  return NextResponse.json({
    id: cls.id,
    name: cls.name,
    createdAt: cls.createdAt,
    students,
    codes,
  });
}
