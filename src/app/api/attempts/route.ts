import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const schema = z.object({
  taskId: z.string().min(1),
  contentType: z.string().min(3),
  durationSec: z.number().positive().max(120),
});

export async function POST(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = schema.parse(await req.json());
    const task = await prisma.task.findUnique({ where: { id: body.taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const taskMeta = (task.metaJson || {}) as {
      supportsPronAssessment?: boolean;
      maxDurationSec?: number;
    };
    const taskMaxDuration =
      typeof taskMeta.maxDurationSec === "number"
        ? taskMeta.maxDurationSec
        : taskMeta.supportsPronAssessment
        ? 30
        : 60;

    if (body.durationSec > taskMaxDuration) {
      return NextResponse.json(
        { error: `Recording too long. Max ${taskMaxDuration}s for this task.` },
        { status: 400 }
      );
    }

    const contentType = body.contentType;
    const extension = contentType.includes("ogg")
      ? "ogg"
      : contentType.includes("mp4")
      ? "mp4"
      : "wav";
    const objectKey = `attempts/${student.studentId}/${uuidv4()}.${extension}`;

    const attempt = await prisma.attempt.create({
      data: {
        studentId: student.studentId,
        taskId: body.taskId,
        status: "created",
        audioObjectKey: objectKey,
        durationSec: body.durationSec,
      },
    });

    return NextResponse.json({
      attemptId: attempt.id,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
