import { GseRawNode, GithubDerivedVocabRow } from "./types";
import { normalizeToken, toGseCenter } from "./utils";

function parseGseRange(value: string | undefined) {
  if (!value) return { min: null, max: null };
  const match = value.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (match) {
    return {
      min: Number(match[1]),
      max: Number(match[2]),
    };
  }
  const single = value.match(/\b(\d{1,2})\b/);
  if (!single) return { min: null, max: null };
  const n = Number(single[1]);
  return { min: n, max: n };
}

function splitMultiValue(input: string | undefined) {
  if (!input) return [];
  return input
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeGithubVocabRows(rows: GithubDerivedVocabRow[]): GseRawNode[] {
  return rows
    .filter((row) => row.word && Number.isFinite(row.gse))
    .map((row) => ({
      type: "GSE_VOCAB" as const,
      catalog: "gse_vocab",
      sourceKey: normalizeToken(row.word),
      descriptor: row.word.toLowerCase(),
      gseMin: Math.round(row.gse),
      gseMax: Math.round(row.gse),
      gseCenter: Number(row.gse),
      cefrBand: row.cefr || null,
      audience: "YL",
      skill: "vocabulary",
      source: "github_derived" as const,
      sourceVersion: null,
      licenseTag: "Unknown",
      metadata: {
        topics: row.topics || [],
        categories: row.categories || [],
      },
    }));
}

export function parseOfficialCsvRows(csv: string): GseRawNode[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((v) => v.trim().toLowerCase());
  const indexOf = (names: string[]) => header.findIndex((h) => names.includes(h));
  const descriptorIdx = indexOf(["descriptor", "learning objective", "objective", "text", "can do statement"]);
  const gseIdx = indexOf(["gse", "gse range", "gse_range"]);
  const cefrIdx = indexOf(["cefr", "cefr band"]);
  const skillIdx = indexOf(["skill"]);
  const audienceIdx = indexOf(["audience"]);
  const typeIdx = indexOf(["type"]);
  const sourceKeyIdx = indexOf(["sourcekey", "source_key", "id", "code"]);

  if (descriptorIdx < 0) return [];

  const nodes: GseRawNode[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((v) => v.trim());
    const descriptor = cols[descriptorIdx];
    if (!descriptor) continue;
    const range = parseGseRange(gseIdx >= 0 ? cols[gseIdx] : undefined);
    const nodeTypeRaw = typeIdx >= 0 ? cols[typeIdx].toUpperCase() : "GSE_LO";
    const type =
      nodeTypeRaw === "GSE_VOCAB" || nodeTypeRaw === "GSE_GRAMMAR" || nodeTypeRaw === "GSE_LO"
        ? nodeTypeRaw
        : "GSE_LO";
    const sourceKey = sourceKeyIdx >= 0 ? cols[sourceKeyIdx] : descriptor;
    const audienceRaw = (audienceIdx >= 0 ? cols[audienceIdx] : "YL").toUpperCase();
    const audience = (["YL", "AL", "AE", "PE"].includes(audienceRaw) ? audienceRaw : "YL") as
      | "YL"
      | "AL"
      | "AE"
      | "PE";
    const skillRaw = (skillIdx >= 0 ? cols[skillIdx] : "").toLowerCase();
    const skill =
      skillRaw === "speaking" ||
      skillRaw === "listening" ||
      skillRaw === "reading" ||
      skillRaw === "writing" ||
      skillRaw === "grammar" ||
      skillRaw === "vocabulary"
        ? skillRaw
        : type === "GSE_VOCAB"
        ? "vocabulary"
        : type === "GSE_GRAMMAR"
        ? "grammar"
        : "speaking";

    nodes.push({
      type,
      catalog: audience === "YL" ? "gse_yl" : audience === "AE" ? "gse_adult_academic" : "gse_adult_general",
      sourceKey: sourceKey || descriptor,
      descriptor,
      gseMin: range.min,
      gseMax: range.max,
      gseCenter: toGseCenter(range.min, range.max),
      cefrBand: cefrIdx >= 0 ? cols[cefrIdx] : null,
      audience,
      skill,
      source: "official",
      sourceVersion: null,
      licenseTag: "Pearson Export",
      metadata: {},
    });
  }

  return nodes;
}

export async function parseOfficialXlsxRows(buffer: Buffer): Promise<GseRawNode[]> {
  const mod = await import("xlsx");
  const workbook = mod.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const csv = mod.utils.sheet_to_csv(sheet);
  return parseOfficialCsvRows(csv);
}

export async function parseOfficialPdfRows(buffer: Buffer): Promise<GseRawNode[]> {
  const mod = await import("pdf-parse");
  const parser = new mod.PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  const lines = parsed.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows: GseRawNode[] = [];

  for (const line of lines) {
    const range = parseGseRange(line);
    if (range.min === null && range.max === null) continue;
    const cleaned = line.replace(/^\D*(\d{1,2}\s*[-–]?\s*\d{0,2})\D*/, "").trim();
    if (!cleaned || cleaned.length < 8) continue;
    rows.push({
      type: "GSE_LO",
      catalog: "gse_official_pdf",
      sourceKey: cleaned,
      descriptor: cleaned,
      gseMin: range.min,
      gseMax: range.max,
      gseCenter: toGseCenter(range.min, range.max),
      cefrBand: null,
      audience: "YL",
      skill: "speaking",
      source: "official",
      sourceVersion: null,
      licenseTag: "Pearson PDF",
      metadata: {
        parsedFrom: "pdf_line",
      },
    });
  }

  return rows;
}

export function parseGithubScraperRows(input: Array<Record<string, unknown>>): GithubDerivedVocabRow[] {
  return input
    .map((row) => {
      const word = String(row.word || row.vocab || row.lemma || "").trim();
      const gseRaw = Number(row.gse || row.gseCenter || row.gse_score);
      const cefr = row.cefr ? String(row.cefr) : null;
      const topics = splitMultiValue(row.topics ? String(row.topics) : undefined);
      const categories = splitMultiValue(row.categories ? String(row.categories) : undefined);
      return {
        word,
        gse: gseRaw,
        cefr,
        topics,
        categories,
      };
    })
    .filter((item) => item.word.length > 0 && Number.isFinite(item.gse));
}
