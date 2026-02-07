import { NextResponse } from "next/server";
import { clearTeacherSessionCookie } from "@/lib/auth";

export async function POST() {
  await clearTeacherSessionCookie();
  return NextResponse.json({ ok: true });
}
