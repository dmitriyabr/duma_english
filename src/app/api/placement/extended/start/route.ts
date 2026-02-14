import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { startPlacementExtended } from "@/lib/placement/extended";

export async function POST() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { session, task } = await startPlacementExtended(student.studentId);

  return NextResponse.json({
    sessionId: session.id,
    task: {
      taskId: task.id,
      type: task.type,
      prompt: task.prompt,
      metaJson: task.metaJson,
    },
  });
}
