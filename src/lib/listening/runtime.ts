import crypto from "node:crypto";
import {
  extractListeningQuestion,
  extractListeningScript,
} from "@/lib/taskText";

export const LISTENING_RUNTIME_VERSION = "listening-runtime-v2" as const;

export type ListeningAssetMeta = {
  assetId: string;
  durationSec: number;
  runtimeVersion: typeof LISTENING_RUNTIME_VERSION;
};

export type ListeningPayload = {
  audioUrl: string;
  durationSec: number;
  assetId: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function estimateDurationSec(script: string) {
  const words = script
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(8, Math.min(120, Math.round(words * 0.48 + 2)));
}

function fallbackQuestionFromScript(script: string) {
  const firstSentence = script
    .split(/[.!?]+/)
    .map((row) => row.trim())
    .find((row) => row.length >= 12);
  if (!firstSentence) return "What is the most important detail in the audio?";
  return `What happened: ${firstSentence}?`;
}

function buildSyntheticAssetId(script: string, question: string) {
  const hash = crypto
    .createHash("sha1")
    .update(`${script}\n${question}`)
    .digest("hex")
    .slice(0, 18);
  return `listening_${hash}`;
}

export function buildListeningRuntimePayload(params: {
  taskId?: string;
  prompt: string;
  taskMeta?: Record<string, unknown> | null;
}) {
  const taskMeta = asObject(params.taskMeta);
  const metaAsset = asObject(taskMeta.listeningAsset);

  const scriptCandidate =
    asString(taskMeta.listeningScript) ||
    asString(extractListeningScript(params.prompt)) ||
    null;
  const question =
    asString(taskMeta.listeningQuestion) ||
    asString(extractListeningQuestion(params.prompt)) ||
    fallbackQuestionFromScript(scriptCandidate || params.prompt);
  const script = scriptCandidate || question;

  const visiblePrompt = `Listen to the audio and answer.\nQuestion: ${question}`;

  const durationSec =
    asNumber(metaAsset.durationSec) ??
    estimateDurationSec(script || question);
  const assetId =
    asString(metaAsset.assetId) ||
    (params.taskId && params.taskId.trim().length > 0 ? params.taskId : null) ||
    buildSyntheticAssetId(script || params.prompt, question);

  const listeningAsset: ListeningAssetMeta = {
    assetId,
    durationSec,
    runtimeVersion: LISTENING_RUNTIME_VERSION,
  };

  const nextTaskMeta: Record<string, unknown> = {
    ...taskMeta,
    modality: "listening",
    listeningPromptVersion: LISTENING_RUNTIME_VERSION,
    listeningScript: script,
    listeningQuestion: question,
    listeningAsset,
  };

  const listeningPayload: ListeningPayload = {
    audioUrl: `/api/listening/assets/${encodeURIComponent(assetId)}`,
    durationSec,
    assetId,
  };

  return {
    visiblePrompt,
    hiddenScript: script,
    question,
    listeningAsset,
    taskMeta: nextTaskMeta,
    listeningPayload,
  };
}

export function parseListeningRuntimeMeta(taskMeta: unknown): {
  script: string;
  question: string;
  asset: ListeningAssetMeta;
} | null {
  const meta = asObject(taskMeta);
  const script = asString(meta.listeningScript);
  const question = asString(meta.listeningQuestion);
  const assetMeta = asObject(meta.listeningAsset);
  const assetId = asString(assetMeta.assetId);
  const durationSec = asNumber(assetMeta.durationSec);

  if (!script || !question || !assetId || durationSec === null) {
    return null;
  }

  return {
    script,
    question,
    asset: {
      assetId,
      durationSec,
      runtimeVersion: LISTENING_RUNTIME_VERSION,
    },
  };
}

export const __internal = {
  estimateDurationSec,
  fallbackQuestionFromScript,
  buildSyntheticAssetId,
};
