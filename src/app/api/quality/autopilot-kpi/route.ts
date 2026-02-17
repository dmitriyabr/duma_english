import { NextRequest, NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildAutopilotKpiDashboard } from "@/lib/kpi/autopilotDashboard";

function parseWindowDays(value: string | null) {
  if (!value) return 30;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(180, Math.round(parsed)));
}

export async function GET(request: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const windowDays = parseWindowDays(request.nextUrl.searchParams.get("windowDays"));
    const report = await buildAutopilotKpiDashboard({ windowDays });
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown KPI dashboard error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
