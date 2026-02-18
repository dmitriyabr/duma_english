export const PERCEPTION_LANGUAGE_SIGNALS_VERSION = "perception-language-signals-v1" as const;

export type PerceptionLanguageTag = "english" | "swahili" | "sheng" | "home_language_hint";
type InternalTokenTag = PerceptionLanguageTag | "unknown";

export type PerceptionLanguageTagSummary = {
  tag: PerceptionLanguageTag;
  confidence: number;
  tokenCount: number;
  tokenRatio: number;
  sampleTokens: string[];
};

export type PerceptionHomeLanguageHint = {
  language: string;
  tokenCount: number;
  confidence: number;
  sampleTokens: string[];
};

export type PerceptionCodeSwitchSignal = {
  detected: boolean;
  tagSet: PerceptionLanguageTag[];
  transitions: number;
  confidence: number;
  dominantPair: string | null;
};

export type PerceptionLanguageSignals = {
  version: typeof PERCEPTION_LANGUAGE_SIGNALS_VERSION;
  tokenCount: number;
  primaryTag: PerceptionLanguageTag | "unknown";
  primaryConfidence: number;
  tags: PerceptionLanguageTagSummary[];
  codeSwitch: PerceptionCodeSwitchSignal;
  homeLanguageHints: PerceptionHomeLanguageHint[];
};

const ENGLISH_STOPWORDS = new Set([
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "my",
  "your",
  "our",
  "their",
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "should",
  "may",
  "might",
  "to",
  "for",
  "of",
  "on",
  "in",
  "at",
  "from",
  "with",
  "about",
  "as",
  "if",
  "because",
  "when",
  "then",
  "after",
  "before",
  "and",
  "or",
  "but",
  "so",
  "that",
  "this",
  "these",
  "those",
  "what",
  "where",
  "why",
  "how",
  "who",
  "which",
  "a",
  "an",
  "the",
  "learn",
  "school",
  "friend",
  "today",
  "like",
  "play",
  "read",
  "speak",
  "english",
  "class",
  "home",
  "work",
  "study",
  "practice",
  "good",
  "better",
  "best",
  "answer",
  "task",
  "example",
]);

const SWAHILI_LEXICON = new Set([
  "habari",
  "sasa",
  "asante",
  "karibu",
  "rafiki",
  "shule",
  "mimi",
  "wewe",
  "yeye",
  "sisi",
  "wao",
  "kweli",
  "sana",
  "leo",
  "jana",
  "kesho",
  "lakini",
  "kwa",
  "kuna",
  "niko",
  "hapa",
  "sawa",
  "tafadhali",
  "chakula",
  "maji",
  "ndio",
  "hapana",
  "pole",
  "vizuri",
]);

const SHENG_LEXICON = new Set([
  "manze",
  "msee",
  "mse",
  "niaje",
  "mambo",
  "poa",
  "supa",
  "rada",
  "dem",
  "buda",
  "mtaa",
  "mtaani",
  "nadai",
  "niko",
  "fiti",
  "sawa",
  "siati",
  "ngori",
  "mbogi",
  "dame",
  "bro",
]);

const HOME_LANGUAGE_HINTS: Record<string, string[]> = {
  kikuyu: ["uhoro", "niwega", "wega", "guku", "witu"],
  luo: ["ber", "ahinya", "erokamano", "amosi"],
  kalenjin: ["chamgei", "kongoi", "mising"],
  luhya: ["mulembe", "khumakho", "khubolela"],
  kamba: ["wendo", "wii", "vakwa"],
};

const HOME_TOKEN_TO_LANGUAGE = new Map<string, string>();
for (const [language, tokens] of Object.entries(HOME_LANGUAGE_HINTS)) {
  for (const token of tokens) {
    HOME_TOKEN_TO_LANGUAGE.set(token, language);
  }
}

function tokenizeTranscript(transcript: string) {
  return transcript
    .toLowerCase()
    .replace(/[^a-z'\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function pushUnique(target: string[], token: string, limit: number) {
  if (target.length >= limit) return;
  if (!target.includes(token)) target.push(token);
}

function classifyToken(token: string): InternalTokenTag {
  if (SHENG_LEXICON.has(token)) return "sheng";
  if (SWAHILI_LEXICON.has(token)) return "swahili";
  if (HOME_TOKEN_TO_LANGUAGE.has(token)) return "home_language_hint";
  if (ENGLISH_STOPWORDS.has(token)) return "english";
  if (/^[a-z]{3,}$/.test(token)) return "english";
  return "unknown";
}

function buildCodeSwitchSignal(params: {
  tokenSequence: PerceptionLanguageTag[];
  summaries: PerceptionLanguageTagSummary[];
}) {
  const secondaryThreshold = 0.12;
  const activeTags = params.summaries
    .filter((row) => row.tokenCount >= 2 || row.tokenRatio >= secondaryThreshold)
    .map((row) => row.tag);

  const dedupedActiveTags = Array.from(new Set(activeTags));
  const hasPrimaryAndSecondary =
    dedupedActiveTags.length >= 2 ||
    (params.summaries.length >= 2 &&
      params.summaries[0].tokenCount > 0 &&
      params.summaries[1].tokenCount > 0 &&
      params.summaries[1].confidence >= 0.16);

  const tagSet = hasPrimaryAndSecondary
    ? Array.from(
        new Set(
          dedupedActiveTags.length >= 2
            ? dedupedActiveTags
            : [params.summaries[0].tag, params.summaries[1].tag]
        )
      )
    : [];

  let transitions = 0;
  if (tagSet.length >= 2) {
    let previous: PerceptionLanguageTag | null = null;
    for (const tokenTag of params.tokenSequence) {
      if (!tagSet.includes(tokenTag)) continue;
      if (previous && previous !== tokenTag) transitions += 1;
      previous = tokenTag;
    }
  }

  const detected = tagSet.length >= 2;
  const secondConfidence = params.summaries[1]?.confidence || 0;
  const transitionBoost = transitions / Math.max(8, params.tokenSequence.length);
  const confidence = detected ? Number(Math.min(1, secondConfidence + transitionBoost).toFixed(4)) : 0;
  const dominantPair = detected
    ? `${params.summaries[0]?.tag || "unknown"}_${params.summaries[1]?.tag || "unknown"}`
    : null;

  return {
    detected,
    tagSet,
    transitions,
    confidence,
    dominantPair,
  };
}

export function inferPerceptionLanguageSignals(params: { transcript: string }): PerceptionLanguageSignals {
  const tokens = tokenizeTranscript(params.transcript || "");
  const tagCounts = new Map<PerceptionLanguageTag, number>();
  const tagSamples: Record<PerceptionLanguageTag, string[]> = {
    english: [],
    swahili: [],
    sheng: [],
    home_language_hint: [],
  };
  const tokenSequence: PerceptionLanguageTag[] = [];
  const homeHintCounts = new Map<string, number>();
  const homeHintSamples = new Map<string, string[]>();

  for (const token of tokens) {
    const tag = classifyToken(token);
    if (tag === "unknown") continue;

    tokenSequence.push(tag);
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    pushUnique(tagSamples[tag], token, 6);

    if (tag === "home_language_hint") {
      const language = HOME_TOKEN_TO_LANGUAGE.get(token);
      if (language) {
        homeHintCounts.set(language, (homeHintCounts.get(language) || 0) + 1);
        const languageSamples = homeHintSamples.get(language) || [];
        pushUnique(languageSamples, token, 4);
        homeHintSamples.set(language, languageSamples);
      }
    }
  }

  const totalTokenCount = tokens.length;
  if (totalTokenCount === 0) {
    return {
      version: PERCEPTION_LANGUAGE_SIGNALS_VERSION,
      tokenCount: 0,
      primaryTag: "unknown",
      primaryConfidence: 0,
      tags: [],
      codeSwitch: {
        detected: false,
        tagSet: [],
        transitions: 0,
        confidence: 0,
        dominantPair: null,
      },
      homeLanguageHints: [],
    };
  }

  const priors: Record<PerceptionLanguageTag, number> = {
    english: 0.25,
    swahili: 0.05,
    sheng: 0.05,
    home_language_hint: 0.05,
  };

  const rawScores = (Object.keys(priors) as PerceptionLanguageTag[]).map((tag) => ({
    tag,
    tokenCount: tagCounts.get(tag) || 0,
    rawScore: (tagCounts.get(tag) || 0) + priors[tag],
  }));
  const rawScoreTotal = rawScores.reduce((sum, row) => sum + row.rawScore, 0) || 1;

  const tagSummaries = rawScores
    .filter((row) => row.tokenCount > 0)
    .map((row) => ({
      tag: row.tag,
      confidence: Number((row.rawScore / rawScoreTotal).toFixed(4)),
      tokenCount: row.tokenCount,
      tokenRatio: Number((row.tokenCount / totalTokenCount).toFixed(4)),
      sampleTokens: tagSamples[row.tag],
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const primaryTag = tagSummaries[0]?.tag || "unknown";
  const primaryConfidence = tagSummaries[0]?.confidence || 0;

  const homeLanguageHints = [...homeHintCounts.entries()]
    .map(([language, tokenCount]) => ({
      language,
      tokenCount,
      confidence: Number((tokenCount / totalTokenCount).toFixed(4)),
      sampleTokens: homeHintSamples.get(language) || [],
    }))
    .sort((a, b) => b.tokenCount - a.tokenCount);

  const codeSwitch = buildCodeSwitchSignal({
    tokenSequence,
    summaries: tagSummaries,
  });

  return {
    version: PERCEPTION_LANGUAGE_SIGNALS_VERSION,
    tokenCount: totalTokenCount,
    primaryTag,
    primaryConfidence,
    tags: tagSummaries,
    codeSwitch,
    homeLanguageHints,
  };
}
