import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function ensureTeacherClass(
  teacherId: string,
  classId: string,
  pagination: { limit: number; offset: number }
) {
  const cls = await prisma.class.findFirst({
    where: { id: classId, teacherId },
    include: {
      _count: {
        select: {
          students: true,
        },
      },
      codes: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
      },
      students: {
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.offset,
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

  const limit = parseBoundedInt(_req.nextUrl.searchParams.get("limit"), 50, 1, 200);
  const offset = parseBoundedInt(_req.nextUrl.searchParams.get("offset"), 0, 0, 10000);
  const { classId } = await params;
  const cls = await ensureTeacherClass(teacher.teacherId, classId, { limit, offset });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const studentIds = cls.students.map((student) => student.id);
  const [lastAttempts, learnerProfiles] = await Promise.all([
    studentIds.length > 0
      ? prisma.attempt.findMany({
          where: { studentId: { in: studentIds }, status: "completed" },
          select: { studentId: true, createdAt: true, scoresJson: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    studentIds.length > 0
      ? prisma.learnerProfile.findMany({
          where: { studentId: { in: studentIds } },
          select: { studentId: true, stage: true },
        })
      : Promise.resolve([]),
  ]);

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

  const stageByStudent = new Map(learnerProfiles.map((profile) => [profile.studentId, profile.stage]));

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
    pagination: {
      limit,
      offset,
      totalStudents: cls._count.students,
      hasMore: offset + students.length < cls._count.students,
    },
  });
}
