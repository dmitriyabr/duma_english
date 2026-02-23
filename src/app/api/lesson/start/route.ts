import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { startLessonRuntime } from "@/lib/lesson/runtime";

const schema = z.object({
  forceNew: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = schema.parse(await req.json().catch(() => ({})));
    const payload = await startLessonRuntime({
      studentId: student.studentId,
      classId: student.classId,
      forceNew: body.forceNew,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start lesson" },
      { status: 400 },
    );
  }
}
