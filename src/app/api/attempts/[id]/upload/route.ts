import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { uploadObject } from "@/lib/storage";

type AttemptUploadRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(req: NextRequest, context: AttemptUploadRouteContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attempt = await prisma.attempt.findFirst({
    where: { id, studentId: student.studentId },
  });

  if (!attempt || !attempt.audioObjectKey) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  if (attempt.status !== "created") {
    return NextResponse.json({ error: "Invalid attempt status" }, { status: 409 });
  }

  const contentType = req.headers.get("content-type") || "application/octet-stream";
  if (!contentType.includes("audio/wav")) {
    return NextResponse.json({ error: "Only audio/wav is accepted" }, { status: 400 });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Empty upload" }, { status: 400 });
  }

  await uploadObject(attempt.audioObjectKey, contentType, bytes);
  await prisma.attempt.update({
    where: { id: attempt.id },
    data: { status: "uploaded" },
  });

  return NextResponse.json({ status: "uploaded" });
}
