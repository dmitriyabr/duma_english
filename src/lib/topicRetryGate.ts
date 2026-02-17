import { z } from "zod";
import { config } from "./config";
import { chatJson } from "./llm";

export const TOPIC_RETRY_REASON_CODE = "RETRY_OFF_TOPIC";
export const TOPIC_RETRY_MESSAGE = "I'm sorry, this sounds like another topic. Let's read the task and try again.";

export type TopicRetryDecision = {
  shouldRetry: boolean;
  reasonCode: typeof TOPIC_RETRY_REASON_CODE | null;
  message: string | null;
  confidence: number | null;
  source: "openai" | "rules" | "skipped";
};

type TopicRetryInput = {
  taskType: string;
  taskPrompt: string;
  transcript: string;
  taskMeta?: Record<string, unknown> | null;
};

const OPENAI_RETRY_THRESHOLD = 0.78;

function normalizeWords(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function splitSentences(input: string) {
  return input
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function promptKeywords(prompt: string) {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "for",
    "of",
    "in",
    "on",
    "with",
    "about",
    "at",
    "is",
    "are",
    "be",
    "you",
    "your",
    "this",
    "that",
    "it",
    "as",
    "by",
    "from",
    "can",
    "please",
    "tell",
    "talk",
    "read",
    "say",
    "answer",
    "question",
  ]);
  return normalizeWords(prompt)
    .filter((word) => word.length >= 3 && !stop.has(word))
    .slice(0, 20);
}

function overlapRatio(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  let shared = 0;
  for (const word of right) {
    if (leftSet.has(word)) shared += 1;
  }
  return shared / Math.max(1, Math.min(left.length, right.length));
}

export function evaluateTopicRetryHeuristic(input: TopicRetryInput): TopicRetryDecision {
  const transcriptWords = normalizeWords(input.transcript);
  if (transcriptWords.length < 12) {
    return { shouldRetry: false, reasonCode: null, message: null, confidence: null, source: "skipped" };
  }

  const firstSentence = splitSentences(input.transcript)[0] || input.transcript;
  const openingWords = normalizeWords(firstSentence).slice(0, 20);
  const promptWords = promptKeywords(input.taskPrompt);
  const openingOverlap = overlapRatio(promptWords, openingWords);

  if (openingOverlap >= 0.08) {
    return { shouldRetry: false, reasonCode: null, message: null, confidence: null, source: "rules" };
  }

  if (input.taskType === "read_aloud") {
    const referenceText =
      typeof input.taskMeta?.referenceText === "string" ? input.taskMeta.referenceText : null;
    const referenceWords = referenceText ? normalizeWords(referenceText).slice(0, 40) : [];
    const transcriptHead = transcriptWords.slice(0, 40);
    const referenceOverlap = overlapRatio(referenceWords, transcriptHead);
    if (referenceWords.length >= 6 && referenceOverlap < 0.1) {
      return {
        shouldRetry: true,
        reasonCode: TOPIC_RETRY_REASON_CODE,
        message: TOPIC_RETRY_MESSAGE,
        confidence: 0.84,
        source: "rules",
      };
    }
  }

  return { shouldRetry: false, reasonCode: null, message: null, confidence: null, source: "rules" };
}

const llmVerdictSchema = z.object({
  shouldRetry: z.boolean(),
  confidence: z.number().min(0).max(1),
  openingOnTopic: z.boolean(),
  reason: z.string().min(1).max(300),
});

function parseMaybeJson(content: string) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fenced?.[1]) return null;
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return null;
    }
  }
}

function makeRetryDecision(confidence: number, source: "openai" | "rules"): TopicRetryDecision {
  return {
    shouldRetry: true,
    reasonCode: TOPIC_RETRY_REASON_CODE,
    message: TOPIC_RETRY_MESSAGE,
    confidence,
    source,
  };
}

export function mapTopicVerdictToDecision(verdict: {
  shouldRetry: boolean;
  confidence: number;
  openingOnTopic: boolean;
}): TopicRetryDecision {
  if (!verdict.shouldRetry) {
    return { shouldRetry: false, reasonCode: null, message: null, confidence: verdict.confidence, source: "openai" };
  }
  if (verdict.openingOnTopic) {
    return { shouldRetry: false, reasonCode: null, message: null, confidence: verdict.confidence, source: "openai" };
  }
  if (verdict.confidence < OPENAI_RETRY_THRESHOLD) {
    return { shouldRetry: false, reasonCode: null, message: null, confidence: verdict.confidence, source: "openai" };
  }
  return makeRetryDecision(verdict.confidence, "openai");
}

export async function evaluateTopicRetryGate(input: TopicRetryInput): Promise<TopicRetryDecision> {
  const heuristic = evaluateTopicRetryHeuristic(input);
  if (heuristic.shouldRetry) return heuristic;

  const transcriptWords = normalizeWords(input.transcript);
  if (transcriptWords.length < 12) return heuristic;

  const apiKey = config.openai.apiKey;
  if (!apiKey) return heuristic;

  const prompt = [
    "Decide if a child should retry because the spoken response is NOT about the task.",
    "Important:",
    "1) Retry ONLY when the response is clearly unrelated/background speech/random sounds.",
    "2) If response starts on topic but drifts later, do NOT retry.",
    "3) Be conservative: when uncertain, do NOT retry.",
    "Return JSON only:",
    '{ "shouldRetry": boolean, "confidence": number, "openingOnTopic": boolean, "reason": string }',
    `Task type: ${input.taskType}`,
    `Task prompt: ${input.taskPrompt.slice(0, 260)}`,
    `Transcript: ${input.transcript.slice(0, 1200)}`,
  ].join("\n");

  try {
    const content = await chatJson(
      "You are a strict but child-friendly speaking relevance checker. Output one JSON object only.",
      prompt,
      {
        openaiApiKey: apiKey,
        model: config.openai.model,
        temperature: 0,
        maxTokens: 220,
        runName: "topic_retry_gate",
        tags: ["gate", "topic_relevance"],
      }
    );
    const raw = parseMaybeJson(content || "");
    const parsed = llmVerdictSchema.safeParse(raw);
    if (!parsed.success) return heuristic;
    return mapTopicVerdictToDecision(parsed.data);
  } catch {
    return heuristic;
  }
}
