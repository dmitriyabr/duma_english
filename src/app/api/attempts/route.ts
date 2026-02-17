import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { appendAutopilotEvent } from "@/lib/autopilot/eventLog";
import { v4 as uuidv4 } from "uuid";

const schema = z.object({
  taskId: z.string().min(1),
  contentType: z.string().min(3),
  durationSec: z.number().positive().max(600),
});

export async function POST(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = schema.parse(await req.json());
    const task = await prisma.task.findUnique({
      where: { id: body.taskId },
      select: {
        id: true,
        metaJson: true,
        taskInstance: {
          select: {
            id: true,
            decisionLogId: true,
          },
        },
      },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const taskMeta = (task.metaJson || {}) as {
      supportsPronAssessment?: boolean;
      assessmentMode?: "pa" | "stt";
      maxDurationSec?: number;
    };
    const taskMode = taskMeta.assessmentMode === "pa" ? "pa" : "stt";
    const taskMaxDuration =
      typeof taskMeta.maxDurationSec === "number"
        ? taskMeta.maxDurationSec
        : taskMode === "pa" || taskMeta.supportsPronAssessment
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
    await appendAutopilotEvent({
      eventType: "attempt_created",
      studentId: student.studentId,
      decisionLogId: task.taskInstance?.decisionLogId || null,
      taskInstanceId: task.taskInstance?.id || null,
      taskId: task.id,
      attemptId: attempt.id,
      payload: {
        status: attempt.status,
        durationSec: body.durationSec,
        contentType: body.contentType,
      },
    });

    return NextResponse.json({
      attemptId: attempt.id,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
