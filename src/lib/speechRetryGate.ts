import type { SpeechMetrics } from "./scoring";

export const SPEECH_RETRY_MESSAGE = "I'm sorry, I didn't hear you well. Can you try again?";

export type SpeechRetryReasonCode =
  | "RETRY_NO_SPEECH"
  | "RETRY_TOO_SHORT"
  | "RETRY_TOO_QUIET"
  | "RETRY_UNINTELLIGIBLE";

export type SpeechRetryDecision = {
  shouldRetry: boolean;
  reasonCode: SpeechRetryReasonCode | null;
  message: string | null;
};

type SpeechRetryGateInput = {
  transcript?: string | null;
  metrics?: SpeechMetrics | null;
  durationSec?: number | null;
};

function countWords(transcript: string) {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasStrongPronunciationSignal(metrics: SpeechMetrics, wordCount: number) {
  if (wordCount < 5) return false;
  const pronunciationSignals = [
    toNumber(metrics.pronunciationTargetRef),
    toNumber(metrics.pronunciationSelfRef),
    toNumber(metrics.accuracy),
  ].filter((value): value is number => value !== null);
  if (pronunciationSignals.length === 0) return false;
  return pronunciationSignals.some((value) => value >= 60);
}

function retry(reasonCode: SpeechRetryReasonCode): SpeechRetryDecision {
  return {
    shouldRetry: true,
    reasonCode,
    message: SPEECH_RETRY_MESSAGE,
  };
}

export function evaluateSpeechRetryGate(input: SpeechRetryGateInput): SpeechRetryDecision {
  const transcript = (input.transcript || "").trim();
  const metrics = input.metrics || {};
  const wordCountFromMetrics = toNumber(metrics.wordCount);
  const wordCount = wordCountFromMetrics ?? countWords(transcript);
  const durationSec = toNumber(input.durationSec) ?? toNumber(metrics.durationSec) ?? 0;
  const confidence = toNumber(metrics.confidence);
  const speechRate = toNumber(metrics.speechRate);

  if (durationSec < 1.2) {
    return retry("RETRY_TOO_SHORT");
  }

  if (!transcript || (wordCount < 2 && durationSec >= 1.5)) {
    return retry("RETRY_NO_SPEECH");
  }

  if (hasStrongPronunciationSignal(metrics, wordCount)) {
    return { shouldRetry: false, reasonCode: null, message: null };
  }

  if (confidence !== null && confidence <= 0.28 && wordCount < 6) {
    return retry("RETRY_TOO_QUIET");
  }

  if (confidence !== null && speechRate !== null && confidence <= 0.38 && speechRate < 55 && wordCount < 8) {
    return retry("RETRY_UNINTELLIGIBLE");
  }

  return { shouldRetry: false, reasonCode: null, message: null };
}
