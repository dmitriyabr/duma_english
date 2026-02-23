import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) {
    return NextResponse.json({ error: "classId is required" }, { status: 400 });
  }

  const classroom = await prisma.class.findFirst({
    where: { id: classId, teacherId: teacher.teacherId },
    select: {
      id: true,
      name: true,
      students: {
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          displayName: true,
          loginCode: true,
        },
      },
    },
  });

  if (!classroom) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const studentIds = classroom.students.map((student) => student.id);
  const sessions = studentIds.length
    ? await prisma.lessonSession.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          studentId: true,
          status: true,
          startedAt: true,
          updatedAt: true,
          completedAt: true,
        },
      })
    : [];

  const latestByStudent = new Map<string, (typeof sessions)[number]>();
  for (const session of sessions) {
    if (!latestByStudent.has(session.studentId)) {
      latestByStudent.set(session.studentId, session);
    }
  }

  const students = classroom.students.map((student) => {
    const latest = latestByStudent.get(student.id);
    return {
      id: student.id,
      displayName: student.displayName,
      loginCode: student.loginCode,
      lastLessonStatus: latest?.status || "none",
      continueAvailable: latest?.status === "active",
      lastLessonId: latest?.id || null,
      lastLessonUpdatedAt: latest?.updatedAt?.toISOString() || null,
    };
  });

  return NextResponse.json({
    classId: classroom.id,
    className: classroom.name,
    students,
  });
}
