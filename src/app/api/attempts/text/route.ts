import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { uploadObject } from "@/lib/storage";
import { appendAutopilotEvent } from "@/lib/autopilot/eventLog";
import { v4 as uuidv4 } from "uuid";

const schema = z.object({
  taskId: z.string().min(1),
  text: z.string().min(1).max(6000),
  durationSec: z.number().positive().max(1800).optional(),
});

function normalizeSubmissionText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export async function POST(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = schema.parse(await req.json());
    const text = normalizeSubmissionText(body.text);
    const wordCount = countWords(text);
    if (wordCount < 8) {
      return NextResponse.json({ error: "Text is too short. Please write at least 8 words." }, { status: 400 });
    }

    const task = await prisma.task.findUnique({
      where: { id: body.taskId },
      select: {
        id: true,
        type: true,
        prompt: true,
        metaJson: true,
        taskInstance: {
          select: {
            id: true,
            studentId: true,
            decisionLogId: true,
          },
        },
      },
    });

    if (!task || task.taskInstance?.studentId !== student.studentId) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const taskMeta =
      task.metaJson && typeof task.metaJson === "object" && !Array.isArray(task.metaJson)
        ? (task.metaJson as Record<string, unknown>)
        : {};
    const assessmentMode = taskMeta.assessmentMode === "text" ? "text" : "stt";
    const isWritingTask = task.type === "writing_prompt" || assessmentMode === "text";
    if (!isWritingTask) {
      return NextResponse.json({ error: "This task does not accept text submission." }, { status: 409 });
    }

    const durationSec =
      typeof body.durationSec === "number"
        ? body.durationSec
        : Math.max(6, Math.min(900, Math.round(wordCount / 1.8)));
    const objectKey = `attempts/${student.studentId}/${uuidv4()}.txt`;
    await uploadObject(objectKey, "text/plain; charset=utf-8", Buffer.from(text, "utf8"));

    const attempt = await prisma.attempt.create({
      data: {
        studentId: student.studentId,
        taskId: task.id,
        status: "uploaded",
        audioObjectKey: objectKey,
        durationSec,
        transcript: text,
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
        durationSec,
        contentType: "text/plain",
        textSubmission: true,
        wordCount,
      },
    });

    return NextResponse.json({
      attemptId: attempt.id,
      status: "uploaded",
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
