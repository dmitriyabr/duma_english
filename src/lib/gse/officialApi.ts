import { GseRawNode } from "./types";

type VocabularyApiItem = {
  itemId?: string;
  expression?: string;
  audience?: string;
  cefr?: string;
  gse?: string | number;
  grammaticalCategories?: string[];
  topics?: unknown;
  definition?: string;
  example?: string;
  audioFiles?: Record<string, unknown>;
  collos?: unknown[];
  variants?: unknown[];
  region?: Record<string, unknown>;
  thesaurus?: string;
};

type DescriptorApiTag = {
  tagTypeId?: string;
  tags?: Array<{ tagName?: string; tagId?: string }>;
};

type DescriptorApiItem = {
  descriptorId?: string;
  descriptiveId?: string;
  descriptor?: string;
  syllabuses?: Array<{ syllabusName?: string; syllabusId?: string; description?: string }>;
  tags?: DescriptorApiTag[];
  gse?: DescriptorApiTag[];
  grammaticalCategories?: unknown[];
  businessSkills?: unknown[];
  communicativeCategories?: unknown[];
  descriptorStatus?: string;
  additionalInformation?: Record<string, unknown>;
  relatedDescriptors?: unknown[];
  relatedLOs?: unknown;
  occupations?: unknown[];
  books?: unknown[];
  sdf?: unknown[];
  attribution?: string;
  status?: boolean;
  created?: string;
  updated?: string;
};

type OffsetPageResponse<T> = {
  count?: number;
  data?: T[];
};

type PageResponse<T> = {
  count?: number;
  data?: T[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const found = value.match(/\d+(\.\d+)?/);
    if (!found) return null;
    const num = Number(found[0]);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function extractGseValueFromDescriptor(item: DescriptorApiItem): number | null {
  const groups = Array.isArray(item.gse) ? item.gse : [];
  for (const group of groups) {
    const tags = Array.isArray(group.tags) ? group.tags : [];
    for (const tag of tags) {
      const n = toNumber(tag.tagName);
      if (n !== null) return n;
    }
  }
  return null;
}

function extractTagValue(item: DescriptorApiItem, tagTypeId: string): string | null {
  const groups = Array.isArray(item.tags) ? item.tags : [];
  const group = groups.find((entry) => entry.tagTypeId === tagTypeId);
  const tag = group?.tags?.[0]?.tagName;
  return typeof tag === "string" && tag.trim().length > 0 ? tag.trim() : null;
}

function mapSyllabusToAudience(syllabusName: string | undefined): "YL" | "AL" | "AE" | "PE" {
  const name = (syllabusName || "").toUpperCase();
  if (name.includes("YL")) return "YL";
  if (name.includes("AE")) return "AE";
  if (name.includes("PL") || name.includes("PE")) return "PE";
  return "AL";
}

function mapSkillFromTag(skillTag: string | null, fallback: "speaking" | "grammar"): GseRawNode["skill"] {
  const value = (skillTag || "").toLowerCase();
  if (value.includes("speak")) return "speaking";
  if (value.includes("listen")) return "listening";
  if (value.includes("read")) return "reading";
  if (value.includes("writ")) return "writing";
  if (value.includes("gramm")) return "grammar";
  if (value.includes("vocab")) return "vocabulary";
  return fallback;
}

function flattenTopicLabels(topics: unknown) {
  if (!Array.isArray(topics)) return [];
  const labels: string[] = [];
  for (const chain of topics) {
    if (!Array.isArray(chain)) continue;
    const leaf = chain[chain.length - 1];
    if (leaf && typeof leaf === "object" && "description" in leaf) {
      const value = String((leaf as { description?: unknown }).description || "").trim();
      if (value) labels.push(value);
    }
  }
  return Array.from(new Set(labels));
}

export function mapVocabularyApiItemToNode(item: VocabularyApiItem): GseRawNode | null {
  const expression = String(item.expression || "").trim();
  const sourceKey = String(item.itemId || "").trim();
  const gse = toNumber(item.gse);
  if (!expression || !sourceKey || gse === null) return null;

  const audienceCode = String(item.audience || "").toUpperCase();
  const audience: "YL" | "AL" | "AE" | "PE" =
    audienceCode.includes("YL")
      ? "YL"
      : audienceCode.includes("AE")
      ? "AE"
      : audienceCode.includes("PL") || audienceCode.includes("PE")
      ? "PE"
      : "AL";

  return {
    type: "GSE_VOCAB",
    catalog: `gse_vocab_${(item.audience || "unknown").toString().toLowerCase()}`,
    sourceKey,
    descriptor: expression,
    gseMin: Math.round(gse),
    gseMax: Math.round(gse),
    gseCenter: Number(gse),
    cefrBand: item.cefr ? String(item.cefr) : null,
    audience,
    skill: "vocabulary",
    source: "official",
    sourceVersion: null,
    licenseTag: "Pearson API",
    metadata: {
      itemId: item.itemId || null,
      audience: item.audience || null,
      definition: item.definition || null,
      example: item.example || null,
      grammaticalCategories: item.grammaticalCategories || [],
      topics: flattenTopicLabels(item.topics),
      audioFiles: item.audioFiles || {},
      collos: item.collos || [],
      variants: item.variants || [],
      region: item.region || null,
      thesaurus: item.thesaurus || null,
      rawTopics: Array.isArray(item.topics) ? item.topics : [],
    },
  };
}

export function mapDescriptorApiItemToNode(item: DescriptorApiItem, kind: "grammar" | "lo"): GseRawNode | null {
  const descriptor = String(item.descriptor || "").trim();
  const sourceKey = String(item.descriptorId || "").trim();
  const gse = extractGseValueFromDescriptor(item);
  if (!descriptor || !sourceKey || gse === null) return null;

  const firstSyllabus = item.syllabuses?.[0];
  const syllabusName = String(firstSyllabus?.syllabusName || "").trim();
  const audience = mapSyllabusToAudience(syllabusName);
  const skillTag = extractTagValue(item, "SKL");
  const cefrBand = extractTagValue(item, "CEFR");
  const descriptiveId = String(item.descriptiveId || "").trim();

  return {
    type: kind === "grammar" ? "GSE_GRAMMAR" : "GSE_LO",
    catalog:
      kind === "grammar"
        ? `gse_grammar_${(syllabusName || "unknown").toLowerCase()}`
        : `gse_lo_${(syllabusName || "unknown").toLowerCase()}`,
    sourceKey,
    descriptor,
    gseMin: Math.round(gse),
    gseMax: Math.round(gse),
    gseCenter: Number(gse),
    cefrBand,
    audience,
    skill: mapSkillFromTag(skillTag, kind === "grammar" ? "grammar" : "speaking"),
    source: "official",
    sourceVersion: null,
    licenseTag: "Pearson API",
    metadata: {
      descriptorId: item.descriptorId || null,
      descriptiveId: descriptiveId || null,
      descriptorStatus: item.descriptorStatus || null,
      syllabuses: item.syllabuses || [],
      tags: item.tags || [],
      additionalInformation: item.additionalInformation || {},
      relatedDescriptors: item.relatedDescriptors || [],
      relatedLOs: item.relatedLOs || {},
      occupations: item.occupations || [],
      books: item.books || [],
      sdf: item.sdf || [],
      grammaticalCategories: item.grammaticalCategories || [],
      businessSkills: item.businessSkills || [],
      communicativeCategories: item.communicativeCategories || [],
      attribution: item.attribution || null,
      status: typeof item.status === "boolean" ? item.status : null,
      created: item.created || null,
      updated: item.updated || null,
    },
  };
}

async function fetchJsonWithRetry<T>(url: string, retries = 5): Promise<T> {
  let lastStatus = 0;
  let lastError = "";
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "duma-english-official-api-scraper",
          Accept: "application/json",
        },
      });
      if (res.ok) {
        return (await res.json()) as T;
      }
      lastStatus = res.status;
      const bodyPreview = (await res.text()).slice(0, 160);
      lastError = bodyPreview;
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable) {
        throw new Error(`HTTP ${res.status}: ${bodyPreview}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    const backoffMs = 400 * attempt * attempt;
    await sleep(backoffMs);
  }
  throw new Error(`Failed after retries. Status=${lastStatus}, error=${lastError}`);
}

function withQueryParam(url: string, key: string, value: string | number) {
  const parsed = new URL(url);
  parsed.searchParams.set(key, String(value));
  return parsed.toString();
}

export async function scrapeVocabularyNodes(
  baseUrl: string,
  maxPages?: number,
  requestedPageSize = 500
): Promise<GseRawNode[]> {
  const nodes: GseRawNode[] = [];
  const firstUrl = withQueryParam(withQueryParam(baseUrl, "page", 1), "size", requestedPageSize);
  const first = await fetchJsonWithRetry<PageResponse<VocabularyApiItem>>(firstUrl);
  const firstData = Array.isArray(first.data) ? first.data : [];
  const pageSize = Math.max(1, firstData.length || 10);
  const total = Math.max(0, Number(first.count || 0));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cappedPages = typeof maxPages === "number" ? Math.min(totalPages, maxPages) : totalPages;

  for (const item of firstData) {
    const mapped = mapVocabularyApiItemToNode(item);
    if (mapped) nodes.push(mapped);
  }

  for (let page = 2; page <= cappedPages; page += 1) {
    const url = withQueryParam(withQueryParam(baseUrl, "page", page), "size", requestedPageSize);
    const response = await fetchJsonWithRetry<PageResponse<VocabularyApiItem>>(url);
    const data = Array.isArray(response.data) ? response.data : [];
    for (const item of data) {
      const mapped = mapVocabularyApiItemToNode(item);
      if (mapped) nodes.push(mapped);
    }
    if (data.length === 0) break;
    await sleep(80);
  }

  return nodes;
}

export async function scrapeDescriptorNodes(
  baseUrl: string,
  kind: "grammar" | "lo",
  maxOffsets?: number
): Promise<GseRawNode[]> {
  const nodes: GseRawNode[] = [];
  const firstUrl = withQueryParam(baseUrl, "offset", 0);
  const first = await fetchJsonWithRetry<OffsetPageResponse<DescriptorApiItem>>(firstUrl);
  const firstData = Array.isArray(first.data) ? first.data : [];
  const pageSize = Math.max(1, firstData.length || 10);
  const total = Math.max(0, Number(first.count || 0));
  const totalOffsets = Math.max(1, Math.ceil(total / pageSize));
  const cappedOffsets = typeof maxOffsets === "number" ? Math.min(totalOffsets, maxOffsets) : totalOffsets;

  for (const item of firstData) {
    const mapped = mapDescriptorApiItemToNode(item, kind);
    if (mapped) nodes.push(mapped);
  }

  for (let pageIndex = 1; pageIndex < cappedOffsets; pageIndex += 1) {
    const offset = pageIndex * pageSize;
    const url = withQueryParam(baseUrl, "offset", offset);
    const response = await fetchJsonWithRetry<OffsetPageResponse<DescriptorApiItem>>(url);
    const data = Array.isArray(response.data) ? response.data : [];
    for (const item of data) {
      const mapped = mapDescriptorApiItemToNode(item, kind);
      if (mapped) nodes.push(mapped);
    }
    if (data.length === 0) break;
    await sleep(80);
  }

  return nodes;
}
