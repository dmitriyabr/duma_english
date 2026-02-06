import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";

type AttemptCompleteUploadRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: AttemptCompleteUploadRouteContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attempt = await prisma.attempt.findFirst({
    where: { id, studentId: student.studentId },
  });

  if (!attempt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (attempt.status === "completed") {
    return NextResponse.json({ status: attempt.status });
  }

  if (attempt.status === "created") {
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: "uploaded" },
    });
  }

  return NextResponse.json({ status: "uploaded" });
}
