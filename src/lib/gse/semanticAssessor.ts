import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { mapStageToGseRange } from "./utils";
import { chatJson, embedTexts } from "@/lib/llm";
import { appendPipelineDebugEvent, previewText } from "@/lib/pipelineDebugLog";

type CandidateNode = {
  nodeId: string;
  descriptor: string;
  sourceKey: string;
  type: "GSE_LO" | "GSE_GRAMMAR";
  gseCenter: number | null;
  audience: string | null;
  skill: string | null;
  metadataJson: unknown;
};

type ParsedIntent = {
  label: string;
  evidenceSpan: string;
};

export type SemanticEvaluationCandidate = {
  nodeId: string;
  sourceKey: string;
  descriptor: string;
  retrievalScore: number;
};

export type SemanticRetrievalContext = {
  parserModel?: string;
  embeddingModel?: string;
  disabledReason?: string;
  errorMessage?: string;
  debug?: {
    parserFallback: boolean;
    parserErrorMessage?: string;
    loQueryCount: number;
    grammarQueryCount: number;
    loCandidateCount: number;
    grammarCandidateCount: number;
    embeddingNodeCount: number;
  };
  loCandidates: SemanticEvaluationCandidate[];
  grammarCandidates: SemanticEvaluationCandidate[];
};

const PARSER_SCHEMA = z.object({
  loIntents: z
    .array(
      z.object({
        label: z.string().min(2).max(120),
        evidenceSpan: z.string().min(2).max(220),
      })
    )
    .max(12)
    .default([]),
  grammarPatterns: z
    .array(
      z.object({
        label: z.string().min(2).max(120),
        evidenceSpan: z.string().min(2).max(220),
      })
    )
    .max(18)
    .default([]),
});

const DEFAULT_EMBED_MODEL = process.env.GSE_EMBEDDING_MODEL || "text-embedding-3-small";
const DEFAULT_PARSER_MODEL = process.env.GSE_PARSER_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_CANDIDATES_PER_DOMAIN = Number(process.env.GSE_SEMANTIC_MAX_CANDIDATES || 24);

function compactText(value: string, max = 220) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function parseMaybeJson(content: string) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const n = typeof item === "number" ? item : Number(item);
    if (!Number.isFinite(n)) return [];
    out.push(n);
  }
  return out;
}

function hashText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toAudience(ageBand?: string | null) {
  return ageBand === "6-8" || ageBand === "9-11" || ageBand === "12-14" ? "YL" : "AL";
}

function nodeText(node: CandidateNode) {
  const meta = node.metadataJson && typeof node.metadataJson === "object" ? (node.metadataJson as Record<string, unknown>) : {};
  const keywords = Array.isArray(meta.keywords) ? meta.keywords.map((item) => String(item)).filter(Boolean) : [];
  const variants = Array.isArray(meta.variants)
    ? meta.variants.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).filter(Boolean)
    : [];
  const structure = typeof meta.structure === "string" ? meta.structure : "";
  const grammaticalCategory = typeof meta.grammaticalCategory === "string" ? meta.grammaticalCategory : "";
  return compactText(
    [
      node.type === "GSE_LO" ? "Learning objective" : "Grammar descriptor",
      node.descriptor,
      node.sourceKey,
      node.skill || "",
      structure,
      grammaticalCategory,
      ...keywords,
      ...variants.slice(0, 4),
    ]
      .filter(Boolean)
      .join(" | "),
    800
  );
}

async function openAiChatJson(apiKey: string, model: string, system: string, user: string, runName: string) {
  const content = await chatJson(system, user, {
    openaiApiKey: apiKey,
    model,
    temperature: 0,
    maxTokens: 900,
    runName,
    tags: ["gse", "semantic"],
  });
  const json = parseMaybeJson(content);
  if (!json) throw new Error("OpenAI chat invalid JSON");
  return json;
}

function fallbackParser(transcript: string): { loIntents: ParsedIntent[]; grammarPatterns: ParsedIntent[] } {
  const text = compactText(transcript, 1000);
  if (!text) return { loIntents: [], grammarPatterns: [] };
  const loIntents: ParsedIntent[] = [{ label: "Communicates a personal message", evidenceSpan: text.slice(0, 120) }];
  const grammarPatterns: ParsedIntent[] = [];
  if (/\b(have|has)\s+\w+ed\b/i.test(text) || /\b(have|has)\s+been\b/i.test(text)) {
    grammarPatterns.push({ label: "Present perfect usage", evidenceSpan: text.slice(0, 120) });
  }
  if (/\b(was|were|did|went|had)\b/i.test(text)) {
    grammarPatterns.push({ label: "Past-time narration", evidenceSpan: text.slice(0, 120) });
  }
  if (/\b(can|should|must|might|could)\b/i.test(text)) {
    grammarPatterns.push({ label: "Modal verbs", evidenceSpan: text.slice(0, 120) });
  }
  return { loIntents, grammarPatterns };
}

async function parseTranscript(params: {
  apiKey: string;
  parserModel: string;
  transcript: string;
  taskPrompt: string;
  taskType: string;
}) {
  const compactTranscript = compactText(params.transcript, 1400);
  if (!compactTranscript) {
    await appendPipelineDebugEvent({
      event: "semantic_parser_skipped",
      taskType: params.taskType,
      taskPromptPreview: previewText(params.taskPrompt, 260),
      transcriptPreview: previewText(params.transcript, 260),
      reason: "Empty transcript after compaction",
    });
    return {
      parsed: fallbackParser(params.transcript),
      parserFallback: true,
      parserErrorMessage: "Empty transcript after compaction",
    };
  }

  try {
    await appendPipelineDebugEvent({
      event: "semantic_parser_input",
      taskType: params.taskType,
      model: params.parserModel,
      taskPromptPreview: previewText(params.taskPrompt, 260),
      transcriptPreview: previewText(params.transcript, 600),
    });
    const json = await openAiChatJson(
      params.apiKey,
      params.parserModel,
      [
        "You are a GSE (Global Scale of English) linguistic analyzer.",
        "Your job is to turn the transcript into a few reusable learning labels that can be matched to GSE descriptors.",
        "",
        "Extract two lists:",
        "1) LO intents (what communicative action the learner is doing).",
        "2) Grammar patterns (what grammatical structure the learner is attempting).",
        "",
        "Extraction strategy (do not skip):",
        "- EXHAUSTIVE ANALYSIS: Process the entire transcript from start to finish. Do not stop after the first obvious match.",
        "- TOTAL RECALL: Every meaningful clause should be covered by at least one LO intent and at least one Grammar pattern.",
        "- ATOMIC MAPPING: One idea/structure = one entry. Do not group unrelated sentences into one evidenceSpan.",
        "- GRANULARITY: If a clause has multiple intents or structures, list them separately with separate evidenceSpan quotes.",
        "- BEYOND THE PROMPT: The task prompt is important, but you MUST also extract other structures the learner uses (tenses, modals, connectors, question forms).",
        "- TENSE AWARENESS: Identify all tenses used (present/past/future intentions), even if not requested by the prompt.",
        "",
        "LO intent rules (important):",
        "- Labels MUST be reusable across topics and lessons.",
        "- Do NOT include topic nouns or proper names (cats, dogs, London, pizza, mom, Tosha, etc.).",
        "- Write the label as something that could match a generic descriptor, e.g.:",
        "  - Good: 'Express likes and dislikes about familiar topics'",
        "  - Good: 'Describe daily routines'",
        "  - Bad: 'Express dislike for cats'",
        "- If the learner says 'I like ...' or 'I don't like ...', prefer a likes/dislikes LO label (not 'enjoyment of an activity').",
        "",
        "Grammar pattern rules (important):",
        "- Labels MUST describe the intended STRUCTURE, not an error category.",
        "- Forbidden in grammar labels: error, incorrect, mistake, wrong, agreement error.",
        "- If the learner form is wrong, still label the intended structure attempt.",
        "- Note: ASR/transcripts can confuse contractions (e.g. 'there's' vs 'they're'). If context suggests 'there is/are', label the intended 'There is/are' structure.",
        "- Be SPECIFIC enough to retrieve the right GSE grammar descriptor. Avoid overly broad labels when you can name the structure.",
        "  - Prefer: 'It is/It's + adjective', 'Present simple (3rd person singular -s)', 'Like + noun', 'Like + verb-ing', 'Past simple affirmative', \"Past simple (be)\", 'Because clause for reasons'",
        "  - Too broad: 'Present simple' (use only if you truly cannot be more specific).",
        "",
        "Task prompt anchoring (very important):",
        "- If the task prompt asks for a specific form (e.g., \"use 'it's/it is'\" or \"use what/where/why\"), include that as a grammar pattern label if it appears in the transcript.",
        "",
        "evidenceSpan rules:",
        "- evidenceSpan MUST be an exact quote from the transcript (keep fillers like 'uh', 'um').",
        "- Keep evidenceSpan short but sufficient to show the intent/pattern.",
        "",
        "Output limits:",
        "- Return up to 12 loIntents and up to 18 grammarPatterns.",
        "- Prefer coverage over completeness of wording, but do not exceed limits.",
        "",
        "Return strict JSON only (no markdown, no extra keys).",
      ].join("\n"),
      [
        "Task Context:",
        `Task type: ${params.taskType}`,
        `Task prompt: ${compactText(params.taskPrompt, 260)}`,
        `Transcript: ${compactTranscript}`,
        "",
        "JSON Structure:",
        "{",
        '  "loIntents": [{"label": "string", "evidenceSpan": "string"}],',
        '  "grammarPatterns": [{"label": "string", "evidenceSpan": "string"}]',
        "}",
        "",
        "Rules:",
        "- Return only JSON object.",
        "- Keep labels concise and pedagogical.",
        "- Keep evidenceSpan as exact quote from transcript.",
        "- LO labels must be topic-agnostic (no pets/cities/names).",
        "- Grammar labels must be structure names, never error categories.",
        "- Bad grammar label example: 'Subject-verb agreement error'.",
        "- Good grammar label example: 'Present simple, 3rd person singular'.",
        "- If uncertain, return empty arrays.",
      ].join("\n")
      ,
      "gse_semantic_parser"
    );
    const parsed = PARSER_SCHEMA.parse(json);
    await appendPipelineDebugEvent({
      event: "semantic_parser_output",
      taskType: params.taskType,
      model: params.parserModel,
      loIntents: parsed.loIntents,
      grammarPatterns: parsed.grammarPatterns,
    });
    return {
      parsed: {
        loIntents: parsed.loIntents.map((row) => ({
          label: compactText(row.label, 120),
          evidenceSpan: compactText(row.evidenceSpan, 220),
        })),
        grammarPatterns: parsed.grammarPatterns.map((row) => ({
          label: compactText(row.label, 120),
          evidenceSpan: compactText(row.evidenceSpan, 220),
        })),
      },
      parserFallback: false,
    };
  } catch (error) {
    const message = error instanceof Error ? compactText(error.message, 220) : compactText(String(error), 220);
    await appendPipelineDebugEvent({
      event: "semantic_parser_error",
      taskType: params.taskType,
      model: params.parserModel,
      errorMessage: message,
    });
    return {
      parsed: fallbackParser(params.transcript),
      parserFallback: true,
      parserErrorMessage: message,
    };
  }
}

async function loadCandidates(params: {
  stage: string;
  ageBand?: string | null;
}) {
  const range = mapStageToGseRange(params.stage || "A2");
  const audience = toAudience(params.ageBand);
  const [loNodes, grammarNodes] = await Promise.all([
    prisma.gseNode.findMany({
      where: {
        type: "GSE_LO",
        descriptor: { notIn: ["", "No descriptor available."] },
        gseCenter: { gte: range.min - 30, lte: range.max + 30 },
        audience: { in: [audience, "AL", "AE", "YL"] },
      },
      orderBy: [{ gseCenter: "asc" }],
      select: {
        nodeId: true,
        descriptor: true,
        sourceKey: true,
        type: true,
        gseCenter: true,
        audience: true,
        skill: true,
        metadataJson: true,
      },
      take: 320,
    }),
    prisma.gseNode.findMany({
      where: {
        type: "GSE_GRAMMAR",
        descriptor: { notIn: ["", "No grammar descriptor available."] },
        gseCenter: { gte: range.min - 30, lte: range.max + 30 },
        audience: { in: [audience, "AL", "AE", "YL"] },
      },
      orderBy: [{ gseCenter: "asc" }],
      select: {
        nodeId: true,
        descriptor: true,
        sourceKey: true,
        type: true,
        gseCenter: true,
        audience: true,
        skill: true,
        metadataJson: true,
      },
      take: 320,
    }),
  ]);
  return { loNodes: loNodes as CandidateNode[], grammarNodes: grammarNodes as CandidateNode[] };
}

async function ensureNodeEmbeddings(apiKey: string, model: string, nodes: CandidateNode[]) {
  if (nodes.length === 0) return new Map<string, number[]>();
  const ids = nodes.map((node) => node.nodeId);
  const existing = await prisma.gseNodeEmbedding.findMany({
    where: { nodeId: { in: ids }, model },
    select: { nodeId: true, vector: true, textHash: true },
  });
  const byNodeId = new Map(existing.map((row) => [row.nodeId, row]));

  const missing: Array<{ node: CandidateNode; text: string; hash: string }> = [];
  for (const node of nodes) {
    const text = nodeText(node);
    const hash = hashText(text);
    const row = byNodeId.get(node.nodeId);
    if (!row || row.textHash !== hash || asNumberArray(row.vector).length === 0) {
      missing.push({ node, text, hash });
    }
  }

  if (missing.length > 0) {
    const vectors = await embedTexts(missing.map((item) => item.text), {
      openaiApiKey: apiKey,
      model,
    });
    for (let i = 0; i < missing.length; i += 1) {
      const item = missing[i];
      const vector = vectors[i] || [];
      if (vector.length === 0) continue;
      await prisma.gseNodeEmbedding.upsert({
        where: { nodeId: item.node.nodeId },
        update: {
          model,
          textHash: item.hash,
          vector,
          dim: vector.length,
        },
        create: {
          nodeId: item.node.nodeId,
          model,
          textHash: item.hash,
          vector,
          dim: vector.length,
        },
      });
    }
  }

  const refreshed = await prisma.gseNodeEmbedding.findMany({
    where: { nodeId: { in: ids }, model },
    select: { nodeId: true, vector: true },
  });
  return new Map(refreshed.map((row) => [row.nodeId, asNumberArray(row.vector)]));
}

function rankCandidates(params: {
  nodes: CandidateNode[];
  nodeVectors: Map<string, number[]>;
  queryVectors: number[][];
}) {
  const scored: Array<{ node: CandidateNode; score: number }> = [];
  for (const node of params.nodes) {
    const vector = params.nodeVectors.get(node.nodeId);
    if (!vector || vector.length === 0) continue;
    let best = 0;
    for (const queryVector of params.queryVectors) {
      const score = cosineSimilarity(vector, queryVector);
      if (score > best) best = score;
    }
    if (best > 0) {
      scored.push({ node, score: Number(best.toFixed(5)) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES_PER_DOMAIN);
}

function rankCandidatesPerQuery(params: {
  nodes: CandidateNode[];
  nodeVectors: Map<string, number[]>;
  queryVectors: number[][];
  perQueryTake: number;
}) {
  const merged = new Map<
    string,
    { node: CandidateNode; score: number; matchedQueryIdx: number[] }
  >();

  for (let qi = 0; qi < params.queryVectors.length; qi += 1) {
    const queryVector = params.queryVectors[qi];
    const scored: Array<{ node: CandidateNode; score: number }> = [];
    for (const node of params.nodes) {
      const vector = params.nodeVectors.get(node.nodeId);
      if (!vector || vector.length === 0) continue;
      const score = cosineSimilarity(vector, queryVector);
      if (score > 0) scored.push({ node, score: Number(score.toFixed(5)) });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.max(1, params.perQueryTake));
    for (const item of top) {
      const existing = merged.get(item.node.nodeId);
      if (!existing) {
        merged.set(item.node.nodeId, {
          node: item.node,
          score: item.score,
          matchedQueryIdx: [qi],
        });
        continue;
      }
      if (!existing.matchedQueryIdx.includes(qi)) existing.matchedQueryIdx.push(qi);
      if (item.score > existing.score) existing.score = item.score;
    }
  }

  const out = Array.from(merged.values());
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_CANDIDATES_PER_DOMAIN);
}

function prioritizeCoverage<T extends { score: number; matchedQueryIdx: number[] }>(params: {
  candidates: T[];
  queryCount: number;
  prioritizeTopN: number;
  perQueryCap: number;
}) {
  if (params.queryCount <= 1 || params.candidates.length <= 1) return params.candidates;

  const topN = Math.max(0, Math.min(params.prioritizeTopN, params.candidates.length));
  const perQueryCap = Math.max(1, params.perQueryCap);
  const selected: T[] = [];
  const selectedIdx = new Set<number>();

  for (let qi = 0; qi < params.queryCount && selected.length < topN; qi += 1) {
    let takenForQuery = 0;
    for (let ci = 0; ci < params.candidates.length && selected.length < topN; ci += 1) {
      if (selectedIdx.has(ci)) continue;
      const candidate = params.candidates[ci];
      if (!candidate.matchedQueryIdx.includes(qi)) continue;
      selected.push(candidate);
      selectedIdx.add(ci);
      takenForQuery += 1;
      if (takenForQuery >= perQueryCap) break;
    }
  }

  if (selected.length === 0) return params.candidates;

  const remainder: T[] = [];
  for (let ci = 0; ci < params.candidates.length; ci += 1) {
    if (!selectedIdx.has(ci)) remainder.push(params.candidates[ci]);
  }
  return [...selected, ...remainder];
}

export async function buildSemanticEvaluationContext(params: {
  transcript: string;
  taskPrompt: string;
  taskType: string;
  stage: string;
  ageBand?: string | null;
}): Promise<SemanticRetrievalContext> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { loCandidates: [], grammarCandidates: [], disabledReason: "OPENAI_API_KEY missing" };
  }
  if ((process.env.GSE_SEMANTIC_ENABLED || "true") !== "true") {
    return { loCandidates: [], grammarCandidates: [], disabledReason: "GSE_SEMANTIC_ENABLED=false" };
  }

  try {
    const [parserState, candidatePools] = await Promise.all([
      parseTranscript({
        apiKey,
        parserModel: DEFAULT_PARSER_MODEL,
        transcript: params.transcript,
        taskPrompt: params.taskPrompt,
        taskType: params.taskType,
      }),
      loadCandidates({ stage: params.stage, ageBand: params.ageBand }),
    ]);
    const parserSignals = parserState.parsed;

    const loQueries = parserSignals.loIntents.map((item) => `LO intent: ${item.label}`);
    const grammarQueries = parserSignals.grammarPatterns.map((item) => item.label);
    await appendPipelineDebugEvent({
      event: "semantic_retrieval_queries",
      taskType: params.taskType,
      stage: params.stage,
      ageBand: params.ageBand || null,
      loQueryKind: "lo",
      loQueries,
      grammarQueryKind: "grammar",
      grammarQueries,
    });

    if (loQueries.length === 0 && grammarQueries.length === 0) {
      return {
        parserModel: DEFAULT_PARSER_MODEL,
        embeddingModel: DEFAULT_EMBED_MODEL,
        loCandidates: [],
        grammarCandidates: [],
        debug: {
          parserFallback: parserState.parserFallback,
          parserErrorMessage: parserState.parserErrorMessage,
          loQueryCount: loQueries.length,
          grammarQueryCount: grammarQueries.length,
          loCandidateCount: 0,
          grammarCandidateCount: 0,
          embeddingNodeCount: 0,
        },
      };
    }

    const allNodes = [...candidatePools.loNodes, ...candidatePools.grammarNodes];
    const nodeVectors = await ensureNodeEmbeddings(apiKey, DEFAULT_EMBED_MODEL, allNodes);
    const [loQueryVectors, grammarQueryVectors] = await Promise.all([
      loQueries.length > 0
        ? embedTexts(loQueries, { openaiApiKey: apiKey, model: DEFAULT_EMBED_MODEL })
        : Promise.resolve([]),
      grammarQueries.length > 0
        ? embedTexts(grammarQueries, { openaiApiKey: apiKey, model: DEFAULT_EMBED_MODEL })
        : Promise.resolve([]),
    ]);

    const loCandidatesRaw =
      loQueryVectors.length > 1
        ? rankCandidatesPerQuery({
            nodes: candidatePools.loNodes,
            nodeVectors,
            queryVectors: loQueryVectors,
            perQueryTake: 6,
          })
        : rankCandidates({ nodes: candidatePools.loNodes, nodeVectors, queryVectors: loQueryVectors }).map(
            (item) => ({ ...item, matchedQueryIdx: [0] })
          );
    const grammarCandidatesRaw =
      grammarQueryVectors.length > 1
        ? rankCandidatesPerQuery({
            nodes: candidatePools.grammarNodes,
            nodeVectors,
            queryVectors: grammarQueryVectors,
            perQueryTake: 6,
          })
        : rankCandidates({ nodes: candidatePools.grammarNodes, nodeVectors, queryVectors: grammarQueryVectors }).map(
            (item) => ({ ...item, matchedQueryIdx: [0] })
          );

    const loCandidates = loCandidatesRaw.map((item) => ({
      node: item.node,
      score: item.score,
      matchedQueryIdx: item.matchedQueryIdx,
    }));
    const grammarCandidates = grammarCandidatesRaw.map((item) => ({
      node: item.node,
      score: item.score,
      matchedQueryIdx: item.matchedQueryIdx,
    }));

    // Reorder candidates so the front of the list covers each extracted query at least once.
    // The evaluator takes only the first 6/8 candidates; this makes that cutoff more robust.
    const loCandidatesPrioritized = prioritizeCoverage({
      candidates: loCandidates,
      queryCount: loQueries.length,
      prioritizeTopN: 12,
      perQueryCap: 1,
    });
    const grammarCandidatesPrioritized = prioritizeCoverage({
      candidates: grammarCandidates,
      queryCount: grammarQueries.length,
      prioritizeTopN: 12,
      perQueryCap: 2,
    });
    await appendPipelineDebugEvent({
      event: "semantic_retrieval_candidates",
      taskType: params.taskType,
      stage: params.stage,
      ageBand: params.ageBand || null,
      disabledReason:
        loCandidatesPrioritized.length === 0 && grammarCandidatesPrioritized.length === 0
          ? "No candidates after retrieval"
          : null,
      // Log only top-N for readability; full candidates are returned from this function.
      loCandidates: loCandidatesPrioritized.slice(0, 12).map((c) => ({
        nodeId: c.node.nodeId,
        sourceKey: c.node.sourceKey,
        descriptor: c.node.descriptor,
        score: c.score,
        matchedQueryIdx: c.matchedQueryIdx,
      })),
      grammarCandidates: grammarCandidatesPrioritized.slice(0, 12).map((c) => ({
        nodeId: c.node.nodeId,
        sourceKey: c.node.sourceKey,
        descriptor: c.node.descriptor,
        score: c.score,
        matchedQueryIdx: c.matchedQueryIdx,
      })),
    });

    return {
      parserModel: DEFAULT_PARSER_MODEL,
      embeddingModel: DEFAULT_EMBED_MODEL,
      disabledReason:
        loCandidatesPrioritized.length === 0 && grammarCandidatesPrioritized.length === 0
          ? "No candidates after retrieval"
          : undefined,
      loCandidates: loCandidatesPrioritized.map((item) => ({
        nodeId: item.node.nodeId,
        sourceKey: item.node.sourceKey,
        descriptor: item.node.descriptor,
        retrievalScore: item.score,
      })),
      grammarCandidates: grammarCandidatesPrioritized.map((item) => ({
        nodeId: item.node.nodeId,
        sourceKey: item.node.sourceKey,
        descriptor: item.node.descriptor,
        retrievalScore: item.score,
      })),
      debug: {
        parserFallback: parserState.parserFallback,
        parserErrorMessage: parserState.parserErrorMessage,
        loQueryCount: loQueries.length,
        grammarQueryCount: grammarQueries.length,
        loCandidateCount: loCandidatesPrioritized.length,
        grammarCandidateCount: grammarCandidatesPrioritized.length,
        embeddingNodeCount: nodeVectors.size,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? compactText(error.message, 220)
        : compactText(String(error), 220);
    return {
      loCandidates: [],
      grammarCandidates: [],
      parserModel: DEFAULT_PARSER_MODEL,
      embeddingModel: DEFAULT_EMBED_MODEL,
      disabledReason: "Semantic retrieval failed",
      errorMessage: message,
    };
  }
}

export async function backfillSemanticEmbeddings(params?: {
  stage?: string;
  ageBand?: string | null;
  includeAll?: boolean;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for embedding backfill");
  }

  let nodes: CandidateNode[] = [];
  if (params?.includeAll) {
    const rows = await prisma.gseNode.findMany({
      where: { type: { in: ["GSE_LO", "GSE_GRAMMAR"] } },
      select: {
        nodeId: true,
        descriptor: true,
        sourceKey: true,
        type: true,
        gseCenter: true,
        audience: true,
        skill: true,
        metadataJson: true,
      },
    });
    nodes = rows as CandidateNode[];
  } else {
    const pools = await loadCandidates({ stage: params?.stage || "A2", ageBand: params?.ageBand || "9-11" });
    nodes = [...pools.loNodes, ...pools.grammarNodes];
  }

  const unique = new Map(nodes.map((node) => [node.nodeId, node]));
  const nodeList = Array.from(unique.values());
  const vectors = await ensureNodeEmbeddings(apiKey, DEFAULT_EMBED_MODEL, nodeList);

  return {
    model: DEFAULT_EMBED_MODEL,
    requested: nodeList.length,
    stored: vectors.size,
  };
}
