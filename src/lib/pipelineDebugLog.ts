import { promises as fs } from "node:fs";
import path from "node:path";

type DebugEvent = {
  event: string;
  ts: string;
  [key: string]: unknown;
};

function isEnabled() {
  return process.env.PIPELINE_DEBUG_LOG_ENABLED === "true";
}

function resolveLogPath() {
  const configured = process.env.PIPELINE_DEBUG_LOG_PATH;
  if (configured && configured.trim().length > 0) return configured.trim();
  return path.join(process.cwd(), "tmp", "pipeline-debug.ndjson");
}

function safePreview(value: string, max = 600) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function previewText(value: unknown, max = 600) {
  if (typeof value !== "string") return null;
  return safePreview(value, max);
}

export async function appendPipelineDebugEvent(event: { event: string; [key: string]: unknown }) {
  if (!isEnabled()) return;
  const filePath = resolveLogPath();
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
  const payload: DebugEvent = { ...event, ts: new Date().toISOString() };
  const line = `${JSON.stringify(payload)}\n`;
  try {
    await fs.appendFile(filePath, line, "utf8");
  } catch {
    // ignore (debug logging must not break runtime)
  }
}
