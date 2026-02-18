import { NextRequest, NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildSelfRepairBudgetTelemetryReport } from "@/lib/quality/selfRepairBudgetTelemetry";

function parseIntParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

export async function GET(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const windowDays = parseIntParam(url.searchParams.get("windowDays"), 30);
  const cycleLimit = parseIntParam(url.searchParams.get("cycleLimit"), 5000);
  const queueLimit = parseIntParam(url.searchParams.get("queueLimit"), 5000);

  const report = await buildSelfRepairBudgetTelemetryReport({
    windowDays,
    cycleLimit,
    queueLimit,
  });
  return NextResponse.json(report);
}
