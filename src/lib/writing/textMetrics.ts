import type { SpeechMetrics } from "@/lib/scoring";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function countWritingWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function deriveWritingSpeechMetrics(params: {
  text: string;
  durationSec?: number | null;
}): SpeechMetrics {
  const text = params.text || "";
  const wordCount = countWritingWords(text);
  const sentenceCount = (text.match(/[.!?]+/g) || []).length;
  const fillerCount = (text.match(/\b(um|uh|like|you know)\b/gi) || []).length;
  const durationSec =
    typeof params.durationSec === "number" && Number.isFinite(params.durationSec) && params.durationSec > 0
      ? params.durationSec
      : clamp(Math.round(wordCount / 1.8), 6, 900);
  const speechRate = durationSec > 0 ? Number(((wordCount / durationSec) * 60).toFixed(2)) : 0;

  return {
    durationSec,
    wordCount,
    speechRate,
    fillerCount,
    pauseCount: Math.max(0, sentenceCount - 1),
    confidence: 0.99,
  };
}
