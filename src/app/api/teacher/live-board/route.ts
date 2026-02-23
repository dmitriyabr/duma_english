import { NextRequest, NextResponse } from "next/server";
import { getTeacherFromRequest } from "@/lib/auth";
import { buildTeacherLiveBoard } from "@/lib/teacher/liveBoard";

export async function GET(req: NextRequest) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) {
    return NextResponse.json({ error: "classId is required" }, { status: 400 });
  }

  const response = await buildTeacherLiveBoard({
    teacherId: teacher.teacherId,
    classId,
  });

  if (!response) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  return NextResponse.json(response);
}
