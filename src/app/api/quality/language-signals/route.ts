import { NextRequest, NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildLanguageSignalTelemetryReport } from "@/lib/quality/languageSignalTelemetry";

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
  const attemptLimit = parseIntParam(url.searchParams.get("attemptLimit"), 5000);
  const sampleLimit = parseIntParam(url.searchParams.get("sampleLimit"), 20);

  const report = await buildLanguageSignalTelemetryReport({
    windowDays,
    attemptLimit,
    sampleLimit,
  });

  return NextResponse.json(report);
}
