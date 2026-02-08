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

async function getStageIndex(params: { stage: string; ageBand?: string | null }) {
  const stage = (params.stage || "A2").trim() || "A2";
  const audience = toAudience(params.ageBand);
  const allowedCatalogs = parseCsv(process.env.GSE_VOCAB_CATALOGS);
  const cacheKey = `${stage}:${audience}:${allowedCatalogs.sort().join(",")}`;
  const ttlMs = Number(process.env.GSE_VOCAB_INDEX_TTL_MS || 10 * 60 * 1000);

  const cached = indexCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < ttlMs) return cached;

  const range = mapStageToGseRange(stage);
  const allowedAudiences =
    allowedCatalogs.length > 0 ? uniqueStrings(allowedCatalogs.map(inferAudienceFromCatalog)) : [audience];
  const nodes = await prisma.gseNode.findMany({
    where: {
      type: "GSE_VOCAB",
      descriptor: { notIn: ["", "No descriptor available."] },
      gseCenter: { gte: range.min - 18, lte: range.max + 18 },
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
    take: 3000,
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

  const idx = await getStageIndex({ stage: params.stage, ageBand: params.ageBand });
  const lemma = await lemmatizeEnglish(text, { taskType: params.taskType, runId: params.runId });

  const lemmaTokens = lemma.tokens
    .map((t) => normalizeWord(t.lemma || t.text))
    .filter((w) => w.length >= 2)
    .slice(0, 220);
  const surfaceTokens = normalizePhrase(text).split(" ").map(normalizeWord).filter((w) => w.length >= 2).slice(0, 220);

  const phraseCandidates = uniqueStrings([
    ...buildNgrams(lemmaTokens, 4),
    ...buildNgrams(surfaceTokens, 4),
  ])
    .filter((p) => p.length >= 2 && p.length <= 80)
    .slice(0, 1200);

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
    .map(([nodeId, row]) => ({ nodeId, score: row.score, matchedPhrases: Array.from(row.matched).slice(0, 6) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(process.env.GSE_VOCAB_MAX_CANDIDATES || 24));

  const maxScore = scored.length > 0 ? scored[0].score : 1;
  const candidates: VocabEvaluationCandidate[] = scored
    .map((row) => {
      const node = idx.nodeById.get(row.nodeId);
      if (!node) return null;
      return {
        nodeId: node.nodeId,
        descriptor: node.descriptor,
        sourceKey: node.sourceKey,
        topicHints: node.topicHints,
        grammaticalCategories: node.grammaticalCategories,
        retrievalScore: Number(Math.max(0, Math.min(1, row.score / maxScore)).toFixed(5)),
        matchedPhrases: row.matchedPhrases,
      };
    })
    .filter(Boolean) as VocabEvaluationCandidate[];

  // Deduplicate exact-sense duplicates: vocab can repeat the same surface form with different TOPIC/CATEGORY.
  // We want to keep distinct senses, but avoid sending multiple identical entries to the evaluator.
  const bestBySense = new Map<string, VocabEvaluationCandidate>();
  const dist = (value: number | null) => (value === null ? 999 : Math.abs(value - idx.stageCenter));
  for (const c of candidates) {
    const descriptorKey = normalizeDescriptorKey(c.descriptor);
    if (!descriptorKey) continue;
    const topicKey = (c.topicHints[0] || "").toLowerCase();
    const catKey = (c.grammaticalCategories[0] || "").toLowerCase();
    const key = `${descriptorKey}||${topicKey}||${catKey}`;
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
  const deduped = Array.from(bestBySense.values());

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
