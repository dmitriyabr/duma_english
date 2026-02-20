import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { rolloutStateSchema } from "@/lib/contracts/rolloutController";

const DEFAULT_STATE_PATH = "docs/reports/CH42_ROLLOUT_STATE.json";
const DEFAULT_LOG_PATH = "docs/reports/CH42_ROLLOUT_CONTROLLER_LOG.ndjson";
const MAX_LOG_LINES = 50;

function getStatePath() {
  return resolve(process.cwd(), process.env.ROLLOUT_STATE_PATH ?? DEFAULT_STATE_PATH);
}

function getLogPath() {
  return resolve(process.cwd(), process.env.ROLLOUT_CONTROLLER_LOG_PATH ?? DEFAULT_LOG_PATH);
}

export async function GET() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statePath = getStatePath();
  const logPath = getLogPath();

  let state = null;
  if (existsSync(statePath)) {
    try {
      const raw = JSON.parse(readFileSync(statePath, "utf8"));
      state = rolloutStateSchema.parse(raw);
    } catch {
      state = null;
    }
  }

  let logEntries: unknown[] = [];
  if (existsSync(logPath)) {
    try {
      const content = readFileSync(logPath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean).slice(-MAX_LOG_LINES);
      logEntries = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
    } catch {
      logEntries = [];
    }
  }

  return NextResponse.json({
    statePath,
    logPath,
    state,
    logEntries,
  });
}
