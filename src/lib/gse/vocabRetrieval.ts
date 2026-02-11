import { prisma } from "@/lib/db";
import { mapStageToGseRange } from "./utils";
import { appendPipelineDebugEvent, previewText } from "@/lib/pipelineDebugLog";
import { lemmatizeEnglish } from "@/lib/nlp/lemmaService";

export type VocabEvaluationCandidate = {
  nodeId: string;
  descriptor: string;
  sourceKey: string;
  topicHints: string[];
  grammaticalCategories: string[];
  retrievalScore: number;
  matchedPhrases: string[];
};

export type VocabRetrievalContext = {
  disabledReason?: string;
  model?: string;
  candidateCount: number;
  candidates: VocabEvaluationCandidate[];
  debug: {
    stage: string;
    ageBand: string | null;
    audience: string;
    catalogs: string[];
    tokenCount: number;
    phraseCandidateCount: number;
    matchedNodeCount: number;
  };
};

type VocabNodeRow = {
  nodeId: string;
  descriptor: string;
  sourceKey: string;
  gseCenter: number | null;
  audience: string | null;
  metadataJson: unknown;
  aliases: Array<{ alias: string }>;
};

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "").trim();
}

function normalizePhrase(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDescriptorKey(value: string) {
  // Collapses trivial punctuation variants like "good!" vs "good".
  return normalizePhrase(value).replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildNgrams(words: string[], maxN = 4) {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let n = 1; n <= maxN; n += 1) {
      if (i + n > words.length) continue;
      out.push(words.slice(i, i + n).join(" "));
    }
  }
  return uniqueStrings(out);
}

function toAudience(ageBand?: string | null) {
  return ageBand === "6-8" || ageBand === "9-11" || ageBand === "12-14" ? "YL" : "AL";
}

function parseCsv(value: string | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "i", "me", "my", "we", "you", "your", "he", "she", "it", "they", "them",
  "a", "an", "the", "is", "am", "are", "was", "were", "be", "been",
  "do", "does", "did", "have", "has", "had", "will", "would", "can", "could",
  "shall", "should", "may", "might", "must",
  "and", "or", "but", "if", "so", "at", "in", "on", "to", "for", "of", "with", "by",
  "not", "no", "yes", "this", "that", "what", "how", "who", "all", "very",
  "just", "about", "up", "out", "there", "here", "then", "than", "too",
]);

function isHumanLexeme(value: string) {
  const normalized = normalizePhrase(value);
  return /^[a-z][a-z0-9' -]{1,48}$/.test(normalized) && !normalized.includes("ua8444");
}

function extractVariantStrings(metadataJson: unknown) {
  if (!metadataJson || typeof metadataJson !== "object") return [];
  const row = metadataJson as Record<string, unknown>;
  const variants = row.variants;
  if (!Array.isArray(variants)) return [];
  const values: string[] = [];
  for (const variant of variants) {
    if (typeof variant === "string") {
      values.push(variant);
      continue;
    }
    if (!variant || typeof variant !== "object") continue;
    for (const key of ["value", "name", "variant", "term", "label", "description"]) {
      const raw = (variant as Record<string, unknown>)[key];
      if (typeof raw === "string" && raw.trim().length > 0) values.push(raw);
    }
  }
  return values;
}

function extractTopicHints(metadataJson: unknown) {
  if (!metadataJson || typeof metadataJson !== "object") return [];
  const row = metadataJson as Record<string, unknown>;
  const topics = row.topics;
  if (!Array.isArray(topics)) return [];
  return uniqueStrings(topics.map((t) => String(t)).map((t) => t.trim()).filter(Boolean)).slice(0, 4);
}

function extractGrammaticalCategoryHints(metadataJson: unknown) {
  if (!metadataJson || typeof metadataJson !== "object") return [];
  const row = metadataJson as Record<string, unknown>;
  const cats = row.grammaticalCategories ?? row.grammaticalCategory;
  if (Array.isArray(cats)) {
    return uniqueStrings(cats.map((c) => String(c)).map((c) => c.trim()).filter(Boolean)).slice(0, 4);
  }
  if (typeof cats === "string" && cats.trim()) return [cats.trim()];
  return [];
}

function collectIndexPhrases(node: VocabNodeRow) {
  const candidates = [
    node.descriptor,
    isHumanLexeme(node.sourceKey) ? node.sourceKey : "",
    ...node.aliases.map((a) => a.alias),
    ...extractVariantStrings(node.metadataJson),
  ]
    .map(normalizePhrase)
    .filter((p) => p.length >= 2 && p.length <= 80);
  return uniqueStrings(candidates);
}

type Index = {
  createdAt: number;
  stageKey: string;
  audience: string;
  catalogs: string[];
  stageCenter: number;
  phraseToNodeIds: Map<string, string[]>;
  nodeById: Map<
    string,
    {
      nodeId: string;
      descriptor: string;
      sourceKey: string;
      gseCenter: number | null;
      topicHints: string[];
      grammaticalCategories: string[];
    }
  >;
};

const indexCache = new Map<string, Index>();

function inferAudienceFromCatalog(catalog: string) {
  const c = String(catalog || "").toLowerCase();
  if (c.includes("yl")) return "YL";
  if (c.includes("academic") || c.includes("ae")) return "AE";
  return "AL";
}

async function getStageIndex(params: { stage: string; ageBand?: string | null; allCatalogs?: boolean }) {
  const stage = (params.stage || "A2").trim() || "A2";
  const audience = toAudience(params.ageBand);
  const allowedCatalogs = params.allCatalogs ? [] : parseCsv(process.env.GSE_VOCAB_CATALOGS);
  const cacheKey = `${stage}:${audience}:${allowedCatalogs.sort().join(",")}`;
  const ttlMs = Number(process.env.GSE_VOCAB_INDEX_TTL_MS || 10 * 60 * 1000);

  const cached = indexCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < ttlMs) return cached;

  const range = mapStageToGseRange(stage);
  const allowedAudiences =
    allowedCatalogs.length > 0 ? uniqueStrings(allowedCatalogs.map(inferAudienceFromCatalog)) : [audience];
  // When searching all catalogs (placement), narrow padding and increase limit
  // to avoid loading 38K+ nodes where take:3000 cuts off before the target range.
  const gsePadding = params.allCatalogs ? 10 : 30;
  const takeLimit = params.allCatalogs ? 12000 : 3000;
  const nodes = await prisma.gseNode.findMany({
    where: {
      type: "GSE_VOCAB",
      descriptor: { notIn: ["", "No descriptor available."] },
      gseCenter: { gte: range.min - gsePadding, lte: range.max + gsePadding },
      ...(allowedCatalogs.length > 0 ? { catalog: { in: allowedCatalogs } } : {}),
      OR: [{ audience: { in: allowedAudiences } }, { audience: null }],
    },
    orderBy: [{ gseCenter: "asc" }],
    select: {
      nodeId: true,
      descriptor: true,
      sourceKey: true,
      gseCenter: true,
      audience: true,
      metadataJson: true,
      aliases: { select: { alias: true } },
    },
    take: takeLimit,
  });

  const phraseToNodeIds = new Map<string, string[]>();
  const nodeById = new Map<
    string,
    {
      nodeId: string;
      descriptor: string;
      sourceKey: string;
      gseCenter: number | null;
      topicHints: string[];
      grammaticalCategories: string[];
    }
  >();

  for (const node of nodes as unknown as VocabNodeRow[]) {
    nodeById.set(node.nodeId, {
      nodeId: node.nodeId,
      descriptor: node.descriptor,
      sourceKey: node.sourceKey,
      gseCenter: node.gseCenter ?? null,
      topicHints: extractTopicHints(node.metadataJson),
      grammaticalCategories: extractGrammaticalCategoryHints(node.metadataJson),
    });
    for (const phrase of collectIndexPhrases(node)) {
      const list = phraseToNodeIds.get(phrase) ?? [];
      list.push(node.nodeId);
      phraseToNodeIds.set(phrase, list);
    }
  }

  const built: Index = {
    createdAt: Date.now(),
    stageKey: stage,
    audience: allowedAudiences.join(","),
    catalogs: allowedCatalogs,
    stageCenter: (range.min + range.max) / 2,
    phraseToNodeIds,
    nodeById,
  };
  indexCache.set(cacheKey, built);
  return built;
}

function scorePhrase(phrase: string) {
  const tokens = phrase.split(" ").filter(Boolean);
  const n = tokens.length;
  const len = phrase.length;
  // Prefer longer n-grams and more "specific" strings.
  return n * 4 + Math.min(12, Math.floor(len / 6));
}

export async function buildVocabEvaluationContext(params: {
  transcript: string;
  stage: string;
  ageBand?: string | null;
  taskType: string;
  runId?: string;
  allCatalogs?: boolean;
}): Promise<VocabRetrievalContext> {
  if ((process.env.GSE_VOCAB_ENABLED || "true") !== "true") {
    return {
      disabledReason: "GSE_VOCAB_ENABLED=false",
      candidateCount: 0,
      candidates: [],
      debug: {
        stage: params.stage,
        ageBand: params.ageBand || null,
        audience: toAudience(params.ageBand),
        catalogs: parseCsv(process.env.GSE_VOCAB_CATALOGS),
        tokenCount: 0,
        phraseCandidateCount: 0,
        matchedNodeCount: 0,
      },
    };
  }

  const text = String(params.transcript || "");
  if (!text.trim()) {
    return {
      disabledReason: "Empty transcript",
      candidateCount: 0,
      candidates: [],
      debug: {
        stage: params.stage,
        ageBand: params.ageBand || null,
        audience: toAudience(params.ageBand),
        catalogs: parseCsv(process.env.GSE_VOCAB_CATALOGS),
        tokenCount: 0,
        phraseCandidateCount: 0,
        matchedNodeCount: 0,
      },
    };
  }

  const idx = await getStageIndex({ stage: params.stage, ageBand: params.ageBand, allCatalogs: params.allCatalogs });
  const lemma = await lemmatizeEnglish(text, { taskType: params.taskType, runId: params.runId });

  // Placement transcripts can be 5 min (~300 words); normal tasks ~60s (~100 words).
  const tokenLimit = params.allCatalogs ? 400 : 220;
  const phraseLimit = params.allCatalogs ? 2000 : 1200;
  const lemmaTokens = lemma.tokens
    .map((t) => normalizeWord(t.lemma || t.text))
    .filter((w) => w.length >= 2)
    .slice(0, tokenLimit);
  const surfaceTokens = normalizePhrase(text).split(" ").map(normalizeWord).filter((w) => w.length >= 2).slice(0, tokenLimit);

  const phraseCandidates = uniqueStrings([
    ...buildNgrams(lemmaTokens, 4),
    ...buildNgrams(surfaceTokens, 4),
  ])
    .filter((p) => p.length >= 2 && p.length <= 80)
    .filter((p) => p.includes(" ") || !STOPWORDS.has(p))
    .slice(0, phraseLimit);

  await appendPipelineDebugEvent({
    event: "vocab_retrieval_phrase_candidates",
    taskType: params.taskType,
    runId: params.runId || null,
    stage: params.stage,
    ageBand: params.ageBand || null,
    candidateCount: phraseCandidates.length,
    top: phraseCandidates.slice(0, 40),
  });

  const nodeAgg = new Map<string, { score: number; matched: Set<string> }>();
  const sortedPhrases = [...phraseCandidates].sort((a, b) => scorePhrase(b) - scorePhrase(a));
  for (const phrase of sortedPhrases) {
    const nodeIds = idx.phraseToNodeIds.get(phrase);
    if (!nodeIds || nodeIds.length === 0) continue;
    const phraseScore = scorePhrase(phrase);
    for (const nodeId of nodeIds) {
      const existing = nodeAgg.get(nodeId) ?? { score: 0, matched: new Set<string>() };
      existing.score += phraseScore;
      existing.matched.add(phrase);
      nodeAgg.set(nodeId, existing);
    }
  }

  const scored = Array.from(nodeAgg.entries())
    .map(([nodeId, row]) => {
      let score = row.score;
      const matched = Array.from(row.matched);
      // Penalize multi-word descriptor nodes matched only by single-word aliases.
      // "build on" matched via "build" alone, or "I don't know what you mean" via "mean" — false positives.
      const node = idx.nodeById.get(nodeId);
      if (node) {
        const descriptorTokens = normalizePhrase(node.descriptor).split(" ").filter(Boolean).length;
        const hasMultiWordMatch = matched.some((p) => p.includes(" "));
        if (descriptorTokens >= 2 && !hasMultiWordMatch) {
          score *= 0.15;
        }
        // Boost nodes where the descriptor itself was matched (not just an alias).
        const normDesc = normalizePhrase(node.descriptor);
        if (matched.some((p) => p === normDesc)) {
          score *= 2;
        }
      }
      return { nodeId, score, matchedPhrases: matched.slice(0, 6) };
    })
    .sort((a, b) => b.score - a.score);

  // Build candidate objects from ALL scored nodes (before slicing).
  const allCandidates: VocabEvaluationCandidate[] = scored
    .map((row) => {
      const node = idx.nodeById.get(row.nodeId);
      if (!node) return null;
      return {
        nodeId: node.nodeId,
        descriptor: node.descriptor,
        sourceKey: node.sourceKey,
        topicHints: node.topicHints,
        grammaticalCategories: node.grammaticalCategories,
        retrievalScore: row.score,
        matchedPhrases: row.matchedPhrases,
      };
    })
    .filter(Boolean) as VocabEvaluationCandidate[];

  // Deduplicate BEFORE slicing so duplicates don't consume candidate slots.
  // For placement mode: dedup by descriptor only (topic/category don't matter for level assessment).
  // For normal mode: keep distinct senses (descriptor + topic + category).
  const bestBySense = new Map<string, VocabEvaluationCandidate>();
  const dist = (value: number | null) => (value === null ? 999 : Math.abs(value - idx.stageCenter));
  for (const c of allCandidates) {
    const descriptorKey = normalizeDescriptorKey(c.descriptor);
    if (!descriptorKey) continue;
    const key = params.allCatalogs
      ? descriptorKey
      : `${descriptorKey}||${(c.topicHints[0] || "").toLowerCase()}||${(c.grammaticalCategories[0] || "").toLowerCase()}`;
    const existing = bestBySense.get(key);
    if (!existing) {
      bestBySense.set(key, c);
      continue;
    }
    if (c.retrievalScore > existing.retrievalScore) {
      bestBySense.set(key, c);
      continue;
    }
    if (c.retrievalScore === existing.retrievalScore) {
      const cMeta = idx.nodeById.get(c.nodeId);
      const eMeta = idx.nodeById.get(existing.nodeId);
      if (dist(cMeta?.gseCenter ?? null) < dist(eMeta?.gseCenter ?? null)) {
        bestBySense.set(key, c);
      }
    }
  }
  const candidateLimit = params.allCatalogs ? 50 : Number(process.env.GSE_VOCAB_MAX_CANDIDATES || 24);
  const deduped = Array.from(bestBySense.values())
    .sort((a, b) => b.retrievalScore - a.retrievalScore)
    .slice(0, candidateLimit);

  // Normalize scores to 0-1
  const maxScore = deduped.length > 0 ? deduped[0].retrievalScore : 1;
  for (const c of deduped) {
    c.retrievalScore = Number(Math.max(0, Math.min(1, c.retrievalScore / maxScore)).toFixed(5));
  }

  await appendPipelineDebugEvent({
    event: "vocab_retrieval_candidates",
    taskType: params.taskType,
    runId: params.runId || null,
    stage: params.stage,
    ageBand: params.ageBand || null,
    transcriptPreview: previewText(text, 300),
    candidateCount: deduped.length,
    top: deduped.slice(0, 10),
  });

  return {
    model: lemma.model,
    candidateCount: deduped.length,
    candidates: deduped,
    debug: {
      stage: params.stage,
      ageBand: params.ageBand || null,
      audience: idx.audience,
      catalogs: idx.catalogs,
      tokenCount: lemmaTokens.length,
      phraseCandidateCount: phraseCandidates.length,
      matchedNodeCount: deduped.length,
    },
  };
}
