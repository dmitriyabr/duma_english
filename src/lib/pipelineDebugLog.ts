import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";

type DebugEvent = {
  event: string;
  ts: string;
  [key: string]: unknown;
};

function isEnabled() {
  return config.pipelineDebug.enabled;
}

function resolveLogPath() {
  const configured = config.pipelineDebug.path;
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
