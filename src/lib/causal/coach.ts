import { chatJson } from "@/lib/llm";
import { config } from "@/lib/config";

export type CausalCoachCard = {
  reasonTitle: string;
  reasonBody: string;
  nextAction: string;
};

const DEFAULT_CAUSAL_COACH: CausalCoachCard = {
  reasonTitle: "Almost there",
  reasonBody: "You had a good try. We just need one clearer answer.",
  nextAction: "Answer in one short sentence, then add one detail.",
};

const COACH_BY_LABEL: Record<string, CausalCoachCard> = {
  rule_confusion: {
    reasonTitle: "Rule mix-up",
    reasonBody: "Your idea was good, but the sentence rule got mixed.",
    nextAction: "Say the same idea again with one clean grammar pattern.",
  },
  l1_interference: {
    reasonTitle: "Language mix-up",
    reasonBody: "A home-language pattern slipped into your English answer.",
    nextAction: "Repeat the answer slowly and keep only English structure.",
  },
  retrieval_failure: {
    reasonTitle: "Word got stuck",
    reasonBody: "You knew the idea, but the key words did not come fast enough.",
    nextAction: "Use a simpler word first, then add the exact word.",
  },
  instruction_misread: {
    reasonTitle: "Task direction missed",
    reasonBody: "You answered, but not the exact task direction.",
    nextAction: "Read the question again and answer the first part directly.",
  },
  attention_loss: {
    reasonTitle: "Focus dropped",
    reasonBody: "Your answer started strong, then lost focus.",
    nextAction: "Give a shorter answer with one main point and one example.",
  },
  production_constraint: {
    reasonTitle: "Speech flow issue",
    reasonBody: "You had the idea, but flow made it hard to hear clearly.",
    nextAction: "Speak a bit slower and pause between two key points.",
  },
  mixed: {
    reasonTitle: "Two things mixed together",
    reasonBody: "More than one issue happened in the same answer.",
    nextAction: "First answer the question directly, then add one clear detail.",
  },
  unknown: DEFAULT_CAUSAL_COACH,
};

function normalizeLabel(label: string | null | undefined) {
  if (!label) return "unknown";
  const normalized = label.trim().toLowerCase();
  return normalized.length > 0 ? normalized : "unknown";
}

export function buildChildCausalCoach(topLabel: string | null | undefined): CausalCoachCard {
  const key = normalizeLabel(topLabel);
  return COACH_BY_LABEL[key] || DEFAULT_CAUSAL_COACH;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compact(value: string | null | undefined, maxChars = 140) {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trim()}...`;
}

export async function buildChildCausalCoachGenerated(params: {
  topLabel: string | null | undefined;
  taskPrompt?: string | null;
  transcript?: string | null;
  feedback?: unknown;
}): Promise<CausalCoachCard> {
  const fallback = buildChildCausalCoach(params.topLabel);
  const apiKey = config.openai.apiKey;
  if (!apiKey) return fallback;

  const feedback = asRecord(params.feedback);
  const feedbackSummary =
    asString(feedback.summary) ||
    asString(feedback.message) ||
    asString(feedback.short) ||
    null;

  const system = [
    "You are a child English coach.",
    "Return strict JSON only: {\"reasonTitle\":\"...\",\"reasonBody\":\"...\",\"nextAction\":\"...\"}.",
    "Keep it specific and actionable.",
    "No jargon and no generic praise.",
    "reasonTitle max 4 words; reasonBody max 12 words; nextAction max 10 words.",
  ].join(" ");

  const user = [
    `causeLabel=${params.topLabel || "unknown"}`,
    `taskPrompt=${params.taskPrompt || "n/a"}`,
    `learnerTranscript=${params.transcript || "n/a"}`,
    `feedbackHint=${feedbackSummary || "n/a"}`,
    `fallbackReasonTitle=${fallback.reasonTitle}`,
    `fallbackReasonBody=${fallback.reasonBody}`,
    `fallbackNextAction=${fallback.nextAction}`,
  ].join("\n");

  try {
    const raw = await chatJson(system, user, {
      openaiApiKey: apiKey,
      model: config.openai.model,
      temperature: 0.2,
      maxTokens: 120,
      runName: "child_causal_coach",
      tags: ["causal", "coach"],
    });
    const parsed = JSON.parse(raw) as {
      reasonTitle?: unknown;
      reasonBody?: unknown;
      nextAction?: unknown;
    };
    const reasonTitle = compact(asString(parsed.reasonTitle), 40);
    const reasonBody = compact(asString(parsed.reasonBody), 120);
    const nextAction = compact(asString(parsed.nextAction), 80);
    if (!reasonTitle || !reasonBody || !nextAction) return fallback;
    return { reasonTitle, reasonBody, nextAction };
  } catch {
    return fallback;
  }
}
