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

