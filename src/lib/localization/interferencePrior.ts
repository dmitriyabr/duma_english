export const L1_INTERFERENCE_PRIOR_VERSION = "l1-interference-prior-v1" as const;

export type InterferenceDomain = "grammar" | "vocab" | "lo" | "mixed";

export type InterferenceLanguageSignals = {
  primaryTag?: string | null;
  tagSet?: string[];
  codeSwitchDetected?: boolean;
  homeLanguageHints?: string[];
};

export type InterferenceTemplate = {
  key: string;
  title: string;
  prompt: string;
};

export type L1InterferencePriorResult = {
  version: typeof L1_INTERFERENCE_PRIOR_VERSION;
  ageBand: string | null;
  domain: InterferenceDomain;
  priorBoost: number;
  languageSignalScore: number;
  template: InterferenceTemplate;
  reasonCodes: string[];
};

type AgeBandBucket = "6-8" | "9-11" | "12-14";

const BASE_PRIOR_BY_AGE_AND_DOMAIN: Record<AgeBandBucket, Record<InterferenceDomain, number>> = {
  "6-8": {
    grammar: 0.18,
    vocab: 0.15,
    lo: 0.13,
    mixed: 0.15,
  },
  "9-11": {
    grammar: 0.23,
    vocab: 0.19,
    lo: 0.16,
    mixed: 0.19,
  },
  "12-14": {
    grammar: 0.21,
    vocab: 0.17,
    lo: 0.2,
    mixed: 0.19,
  },
};

const TEMPLATE_BY_AGE_AND_DOMAIN: Record<AgeBandBucket, Record<InterferenceDomain, InterferenceTemplate>> = {
  "6-8": {
    grammar: {
      key: "l1_grammar_contrast_frames_6_8",
      title: "Grammar contrast with sentence frames",
      prompt:
        "Contrast home-language vs English word order using short guided sentence frames and immediate corrections.",
    },
    vocab: {
      key: "l1_vocab_visual_anchor_6_8",
      title: "Vocabulary transfer with visual anchors",
      prompt:
        "Use picture-supported bilingual anchors and quick retrieval prompts to reduce direct translation transfer errors.",
    },
    lo: {
      key: "l1_dialogue_turn_frames_6_8",
      title: "Turn-taking repair with guided dialogue",
      prompt:
        "Run short role-play turns with explicit English repair phrases and low-load turn-taking scaffolds.",
    },
    mixed: {
      key: "l1_mixed_micro_cycle_6_8",
      title: "Mixed interference micro-cycle",
      prompt:
        "Deliver a three-step cycle: contrastive cue, guided response, and one transfer check in child-friendly language.",
    },
  },
  "9-11": {
    grammar: {
      key: "l1_grammar_minimal_pairs_9_11",
      title: "Minimal-pair grammar contrast",
      prompt:
        "Practice tense and agreement contrasts against common L1 transfer patterns with immediate contrastive feedback.",
    },
    vocab: {
      key: "l1_vocab_false_friends_9_11",
      title: "False-friend disambiguation drill",
      prompt:
        "Use targeted lexical contrasts and retrieval cues to separate English target words from L1-near alternatives.",
    },
    lo: {
      key: "l1_pragmatic_register_switch_9_11",
      title: "Register-switch communication drill",
      prompt:
        "Practice classroom vs conversational English register shifts with focused feedback on repair and audience fit.",
    },
    mixed: {
      key: "l1_mixed_transfer_probe_9_11",
      title: "Mixed transfer probe and repair",
      prompt:
        "Pair a short transfer probe with targeted practice to isolate L1 interference from generic production issues.",
    },
  },
  "12-14": {
    grammar: {
      key: "l1_grammar_argument_scaffold_12_14",
      title: "Argument grammar scaffold",
      prompt:
        "Use contrastive scaffolds for complex sentence control and discourse linking where L1 transfer causes drift.",
    },
    vocab: {
      key: "l1_vocab_context_swap_12_14",
      title: "Context-swap lexical remediation",
      prompt:
        "Challenge near-synonym transfer errors with context-swap tasks and forced-choice explanations.",
    },
    lo: {
      key: "l1_discourse_repair_12_14",
      title: "Discourse repair and register control",
      prompt:
        "Run short debate-style turns focused on clarification, repair moves, and formal/informal register adaptation.",
    },
    mixed: {
      key: "l1_mixed_strategy_cycle_12_14",
      title: "Mixed interference strategy cycle",
      prompt:
        "Apply a contrastive strategy cycle: detect transfer, reformulate, then transfer-check in a new discourse context.",
    },
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function toAgeBandBucket(ageBand?: string | null): {
  bucket: AgeBandBucket;
  fallbackApplied: boolean;
} {
  if (ageBand === "6-8" || ageBand === "9-11" || ageBand === "12-14") {
    return {
      bucket: ageBand,
      fallbackApplied: false,
    };
  }
  return {
    bucket: "9-11",
    fallbackApplied: true,
  };
}

function normalizeTag(value: string | null | undefined) {
  if (!value) return null;
  const tag = value.trim().toLowerCase();
  if (!tag) return null;
  return tag;
}

function summarizeLanguageSignals(signals?: InterferenceLanguageSignals | null) {
  const reasonCodes: string[] = [];
  if (!signals) {
    return {
      score: 0,
      reasonCodes,
    };
  }

  const tagSet = new Set(
    Array.isArray(signals.tagSet)
      ? signals.tagSet
          .map((value) => normalizeTag(value))
          .filter((value): value is string => Boolean(value))
      : [],
  );
  const primaryTag = normalizeTag(signals.primaryTag ?? null);
  const hasHomeHints = Array.isArray(signals.homeLanguageHints)
    ? signals.homeLanguageHints.some((value) => typeof value === "string" && value.trim().length > 0)
    : false;

  let score = 0;
  if (signals.codeSwitchDetected) {
    score += 0.32;
    reasonCodes.push("code_switch_detected");
  }

  if (
    primaryTag === "swahili" ||
    primaryTag === "sheng" ||
    primaryTag === "home_language_hint"
  ) {
    score += 0.44;
    reasonCodes.push("non_english_primary_tag");
  }

  const hasEnglishTag = tagSet.has("english") || primaryTag === "english";
  const hasTransferTag =
    tagSet.has("swahili") ||
    tagSet.has("sheng") ||
    tagSet.has("home_language_hint") ||
    primaryTag === "swahili" ||
    primaryTag === "sheng" ||
    primaryTag === "home_language_hint";
  if (hasEnglishTag && hasTransferTag) {
    score += 0.2;
    reasonCodes.push("bilingual_tag_mix");
  }

  if (hasHomeHints) {
    score += 0.16;
    reasonCodes.push("home_language_hints_present");
  }

  return {
    score: round(clamp(score, 0, 1)),
    reasonCodes,
  };
}

export function toInterferenceDomain(
  value: string | null | undefined,
): InterferenceDomain {
  if (value === "grammar" || value === "vocab" || value === "lo" || value === "mixed") {
    return value;
  }
  return "mixed";
}

export function getL1InterferencePrior(params: {
  ageBand?: string | null;
  domain: InterferenceDomain;
  languageSignals?: InterferenceLanguageSignals | null;
}): L1InterferencePriorResult {
  const age = toAgeBandBucket(params.ageBand);
  const languageSignals = summarizeLanguageSignals(params.languageSignals);
  const basePrior = BASE_PRIOR_BY_AGE_AND_DOMAIN[age.bucket][params.domain];
  const boosted = clamp(basePrior + languageSignals.score * 0.2, 0.05, 0.55);
  const template = TEMPLATE_BY_AGE_AND_DOMAIN[age.bucket][params.domain];

  const reasonCodes = [
    `age_band_${age.bucket}`,
    `domain_${params.domain}`,
    ...languageSignals.reasonCodes,
  ];
  if (age.fallbackApplied) {
    reasonCodes.push("age_band_fallback_9_11");
  }

  return {
    version: L1_INTERFERENCE_PRIOR_VERSION,
    ageBand: params.ageBand || null,
    domain: params.domain,
    priorBoost: round(boosted),
    languageSignalScore: languageSignals.score,
    template,
    reasonCodes,
  };
}
