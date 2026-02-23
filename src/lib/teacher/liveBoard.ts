import { prisma } from "@/lib/db";
import type {
  TeacherLiveBoardResponse,
  TeacherLiveBoardRow,
} from "@/lib/contracts/teacherLiveBoard";

function minutesSince(date: Date) {
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

function estimateEta(remainingSteps: number) {
  if (remainingSteps <= 0) return 0;
  return Math.max(2, remainingSteps * 3);
}

export async function buildTeacherLiveBoard(params: {
  teacherId: string;
  classId: string;
}): Promise<TeacherLiveBoardResponse | null> {
  const classroom = await prisma.class.findFirst({
    where: { id: params.classId, teacherId: params.teacherId },
    select: {
      id: true,
      students: {
        select: {
          id: true,
          displayName: true,
        },
        orderBy: { displayName: "asc" },
      },
    },
  });

  if (!classroom) return null;

  const studentIds = classroom.students.map((student) => student.id);
  const sessions = studentIds.length
    ? await prisma.lessonSession.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        include: {
          steps: {
            orderBy: { ordinal: "asc" },
            select: {
              id: true,
              ordinal: true,
              stepType: true,
              status: true,
              source: true,
            },
          },
        },
      })
    : [];

  const activeByStudent = new Map<string, (typeof sessions)[number]>();
  const latestByStudent = new Map<string, (typeof sessions)[number]>();

  for (const session of sessions) {
    if (!latestByStudent.has(session.studentId)) {
      latestByStudent.set(session.studentId, session);
    }
    if (session.status === "active" && !activeByStudent.has(session.studentId)) {
      activeByStudent.set(session.studentId, session);
    }
  }

  const rows: TeacherLiveBoardRow[] = classroom.students.map((student) => {
    const active = activeByStudent.get(student.id);
    const latest = latestByStudent.get(student.id);
    const session = active || latest || null;

    if (!session) {
      return {
        studentId: student.id,
        studentName: student.displayName,
        lessonSessionId: null,
        status: "completed",
        stepType: null,
        stepOrdinal: null,
        stepEtaMin: null,
        blockerLabel: "No lesson yet",
        updatedAt: null,
      };
    }

    const activeStep =
      session.steps.find((step) => step.status === "active") ||
      session.steps.find((step) => step.status === "pending") ||
      null;

    const completedCount = session.steps.filter(
      (step) => step.status === "passed" || step.status === "skipped",
    ).length;
    const remaining = Math.max(0, session.steps.length - completedCount);

    if (session.status === "completed") {
      return {
        studentId: student.id,
        studentName: student.displayName,
        lessonSessionId: session.id,
        status: "completed",
        stepType: activeStep?.stepType || null,
        stepOrdinal: activeStep?.ordinal ?? null,
        stepEtaMin: 0,
        blockerLabel: null,
        updatedAt: session.updatedAt.toISOString(),
      };
    }

    const staleMinutes = minutesSince(session.updatedAt);
    const isRetryLoop = activeStep?.source === "corrective" || activeStep?.stepType === "drill";
    const isStuck = staleMinutes >= 8;

    const status: TeacherLiveBoardRow["status"] = isRetryLoop
      ? "retry_loop"
      : isStuck
      ? "stuck"
      : "in_progress";

    const blockerLabel =
      status === "retry_loop"
        ? "Fix-now loop"
        : status === "stuck"
        ? `No progress for ${staleMinutes} min`
        : null;

    return {
      studentId: student.id,
      studentName: student.displayName,
      lessonSessionId: session.id,
      status,
      stepType: activeStep?.stepType || null,
      stepOrdinal: activeStep?.ordinal ?? null,
      stepEtaMin: estimateEta(remaining),
      blockerLabel,
      updatedAt: session.updatedAt.toISOString(),
    };
  });

  return {
    classId: classroom.id,
    generatedAt: new Date().toISOString(),
    rows,
  };
}
