import { NextRequest, NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildSelfRepairDelayedVerificationReport } from "@/lib/quality/selfRepairDelayedVerificationReport";

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
  const limit = parseIntParam(url.searchParams.get("limit"), 5000);
  const staleThresholdHours = parseIntParam(url.searchParams.get("staleThresholdHours"), 72);

  const report = await buildSelfRepairDelayedVerificationReport({
    windowDays,
    limit,
    staleThresholdHours,
  });
  return NextResponse.json(report);
}
