import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { parseGithubScraperRows } from "./importers";
import { GithubCatalogSource, GithubDerivedVocabRow } from "./types";
import { normalizeToken } from "./utils";

const execFile = promisify(execFileCb);

type GithubTreeNode = {
  path: string;
  type: "blob" | "tree";
  size?: number;
};

type GithubRepoRef = {
  owner: string;
  repo: string;
  ref: string;
};

type GithubImportDiagnostics = {
  repo: string;
  filesScanned: number;
  rowsImported: number;
  usedToolkitBootstrap: boolean;
  notes: string[];
};

type GithubImportResult = {
  rows: GithubDerivedVocabRow[];
  diagnostics: GithubImportDiagnostics[];
};

const GITHUB_API = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";
const TOOLKIT_API = "https://www.english.com/gse/teacher-toolkit/user/api/v1/vocabulary/search";

const DEFAULT_FILE_EXTENSIONS = new Set([".json", ".jsonl", ".csv", ".tsv", ".db", ".sqlite"]);

function inferExtension(path: string) {
  const index = path.lastIndexOf(".");
  if (index < 0) return "";
  return path.slice(index).toLowerCase();
}

function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function splitCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current.trim());
  return values;
}

function parseDelimitedRows(input: string, delimiter: string) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0], delimiter).map((header) => normalizeToken(header));
  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line, delimiter);
    const row: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i] || `col_${i}`] = cols[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

export function parseGithubRepoRef(input: string, refOverride?: string): GithubRepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const slashParts = trimmed.split("/");
  if (slashParts.length >= 2 && !trimmed.includes("github.com")) {
    const owner = slashParts[0]?.trim();
    const repo = slashParts[1]?.trim();
    const ref = refOverride || "main";
    if (owner && repo) return { owner, repo, ref };
  }

  const match = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/?#]+))?/i);
  if (!match || !match[1] || !match[2]) return null;
  return {
    owner: match[1],
    repo: match[2],
    ref: refOverride || match[3] || "main",
  };
}

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "duma-english-gse-importer",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchGithubTree(repo: GithubRepoRef): Promise<GithubTreeNode[]> {
  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(repo.ref)}?recursive=1`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    if (repo.ref === "main") {
      const fallback = await fetchGithubTree({ ...repo, ref: "master" });
      return fallback;
    }
    throw new Error(`GitHub tree fetch failed for ${repo.owner}/${repo.repo}@${repo.ref}: ${res.status}`);
  }
  const payload = safeJsonParse<{ tree?: GithubTreeNode[] }>(await res.text(), {});
  return payload.tree || [];
}

async function downloadGithubRawFile(repo: GithubRepoRef, path: string) {
  const url = `${RAW_GITHUB}/${repo.owner}/${repo.repo}/${repo.ref}/${path}`;
  const res = await fetch(url, { headers: { "User-Agent": "duma-english-gse-importer" } });
  if (!res.ok) {
    throw new Error(`Raw file download failed (${res.status}) for ${repo.owner}/${repo.repo}:${path}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function normalizeGithubRows(rows: Array<Record<string, unknown>>) {
  const normalized = rows.map((row) => ({
    word: String(
      row.word ||
        row.vocab ||
        row.lemma ||
        row.expression ||
        row.lexical_unit ||
        row.token ||
        ""
    ),
    gse: row.gse ?? row.gsecenter ?? row.gse_score ?? row.gsevalue ?? row.gse_value,
    cefr: row.cefr ?? row.cefr_band ?? null,
    topics: row.topics ?? row.topic ?? null,
    categories: row.categories ?? row.category ?? row.grammaticalcategories ?? null,
  }));
  return parseGithubScraperRows(normalized);
}

function splitList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function flattenToolkitTopicLabels(topics: unknown) {
  if (!Array.isArray(topics)) return [];
  const labels: string[] = [];
  for (const chain of topics) {
    if (!Array.isArray(chain)) continue;
    const leaf = chain[chain.length - 1];
    if (leaf && typeof leaf === "object" && "description" in leaf) {
      const desc = String((leaf as { description?: unknown }).description || "").trim();
      if (desc) labels.push(desc);
    }
  }
  return Array.from(new Set(labels));
}

export function mapToolkitVocabularyItem(item: Record<string, unknown>): GithubDerivedVocabRow | null {
  const word = String(item.expression || item.word || "").trim();
  const gse = Number(item.gse ?? item.gseCenter ?? item.gse_score);
  if (!word || !Number.isFinite(gse)) return null;
  return {
    word,
    gse,
    cefr: item.cefr ? String(item.cefr) : null,
    topics: flattenToolkitTopicLabels(item.topics),
    categories: splitList(item.grammaticalCategories),
  };
}

async function parseRowsFromSqliteBuffer(buffer: Buffer): Promise<GithubDerivedVocabRow[]> {
  const dir = await mkdtemp(join(tmpdir(), "gse-import-"));
  const dbFile = join(dir, "source.sqlite");
  try {
    await writeFile(dbFile, buffer);
    const hasTablesQuery = "SELECT name FROM sqlite_master WHERE type='table';";
    const { stdout: tablesStdout } = await execFile("sqlite3", ["-json", dbFile, hasTablesQuery]);
    const tables = safeJsonParse<Array<{ name?: string }>>(tablesStdout || "[]", [])
      .map((row) => String(row.name || "").trim())
      .filter(Boolean);
    const needed = ["link_table", "vocabulary_table", "topics_table", "categories_table"];
    const hasNeeded = needed.every((table) => tables.includes(table));
    if (!hasNeeded) return [];

    const query = `
      SELECT
        v.word AS word,
        CAST(l.gse AS REAL) AS gse,
        l.cefr AS cefr,
        GROUP_CONCAT(DISTINCT t.description) AS topics,
        GROUP_CONCAT(DISTINCT c.description) AS categories
      FROM link_table l
      JOIN vocabulary_table v ON v.link_table_id = l.id
      LEFT JOIN topics_table t ON t.link_table_id = l.id
      LEFT JOIN categories_table c ON c.link_table_id = l.id
      GROUP BY l.id, v.word, l.gse, l.cefr
      ORDER BY l.id;
    `;
    const { stdout } = await execFile("sqlite3", ["-json", dbFile, query]);
    const rows = safeJsonParse<Array<Record<string, unknown>>>(stdout || "[]", []);
    return normalizeGithubRows(rows).map((row) => ({
      ...row,
      topics: splitList(row.topics),
      categories: splitList(row.categories),
    }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function parseRowsFromGithubFile(
  repo: GithubRepoRef,
  path: string
): Promise<GithubDerivedVocabRow[]> {
  const ext = inferExtension(path);
  const buffer = await downloadGithubRawFile(repo, path);

  if (ext === ".db" || ext === ".sqlite") {
    return parseRowsFromSqliteBuffer(buffer);
  }

  const text = buffer.toString("utf8");
  if (ext === ".json") {
    const parsed = safeJsonParse<unknown>(text, null);
    if (Array.isArray(parsed)) return normalizeGithubRows(parsed as Array<Record<string, unknown>>);
    if (parsed && typeof parsed === "object") {
      const data = (parsed as { data?: unknown }).data;
      if (Array.isArray(data)) return normalizeGithubRows(data as Array<Record<string, unknown>>);
      return normalizeGithubRows([parsed as Record<string, unknown>]);
    }
    return [];
  }

  if (ext === ".jsonl") {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const rows = lines
      .map((line) => safeJsonParse<Record<string, unknown> | null>(line, null))
      .filter((row): row is Record<string, unknown> => !!row);
    return normalizeGithubRows(rows);
  }

  if (ext === ".csv" || ext === ".tsv") {
    const delimiter = ext === ".tsv" ? "\t" : ",";
    const rows = parseDelimitedRows(text, delimiter);
    return normalizeGithubRows(rows);
  }

  return [];
}

function dedupeRows(rows: GithubDerivedVocabRow[]) {
  const map = new Map<string, GithubDerivedVocabRow>();
  for (const row of rows) {
    const key = `${normalizeToken(row.word)}|${Math.round(Number(row.gse))}|${row.cefr || ""}`;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

async function fetchToolkitVocabularyRows() {
  const rows: GithubDerivedVocabRow[] = [];
  const size = 2000;
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (rows.length < total) {
    const url = `${TOOLKIT_API}?page=${page}&size=${size}&query_string=*`;
    let payload: { count?: number; data?: Array<Record<string, unknown>> } | null = null;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await fetch(url, { headers: { "User-Agent": "duma-english-gse-importer" } });
      if (res.ok) {
        payload = safeJsonParse<{ count?: number; data?: Array<Record<string, unknown>> }>(
          await res.text(),
          {}
        );
        break;
      }
      lastStatus = res.status;
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`Toolkit API fetch failed (status ${res.status}) on page ${page}`);
      }
      const delayMs = 300 * attempt * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!payload) {
      throw new Error(`Toolkit API fetch failed (status ${lastStatus}) on page ${page}`);
    }
    total = Number(payload.count || 0);
    const data = Array.isArray(payload.data) ? payload.data : [];
    const mapped = data
      .map((item) => mapToolkitVocabularyItem(item))
      .filter((row): row is GithubDerivedVocabRow => !!row);
    rows.push(...mapped);
    if (data.length === 0) break;
    page += 1;
  }
  return dedupeRows(rows);
}

export async function importGseRowsFromGithub(sources: GithubCatalogSource[]): Promise<GithubImportResult> {
  const allRows: GithubDerivedVocabRow[] = [];
  const diagnostics: GithubImportDiagnostics[] = [];

  for (const source of sources) {
    const parsed = parseGithubRepoRef(source.repo, source.ref);
    if (!parsed) {
      diagnostics.push({
        repo: source.repo,
        filesScanned: 0,
        rowsImported: 0,
        usedToolkitBootstrap: false,
        notes: ["invalid repo format"],
      });
      continue;
    }

    const tree = await fetchGithubTree(parsed);
    const blobFiles = tree.filter((node) => node.type === "blob");
    const dataFiles = blobFiles.filter((node) => DEFAULT_FILE_EXTENSIONS.has(inferExtension(node.path)));
    const files = typeof source.maxFiles === "number" ? dataFiles.slice(0, source.maxFiles) : dataFiles;
    const notes: string[] = [];
    const rows: GithubDerivedVocabRow[] = [];

    for (const file of files) {
      try {
        const parsedRows = await parseRowsFromGithubFile(parsed, file.path);
        rows.push(...parsedRows);
      } catch (error) {
        notes.push(`failed ${file.path}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    let usedToolkitBootstrap = false;
    if (rows.length === 0 && source.includeToolkitBootstrap) {
      const hasKnownScraper = blobFiles.some((file) => file.path.toLowerCase().includes("gse_webscraper.py"));
      if (hasKnownScraper) {
        const toolkitRows = await fetchToolkitVocabularyRows();
        rows.push(...toolkitRows);
        usedToolkitBootstrap = true;
        notes.push(`toolkit bootstrap used (${toolkitRows.length} rows)`);
      }
    }

    const deduped = dedupeRows(rows);
    diagnostics.push({
      repo: `${parsed.owner}/${parsed.repo}@${parsed.ref}`,
      filesScanned: files.length,
      rowsImported: deduped.length,
      usedToolkitBootstrap,
      notes,
    });
    allRows.push(...deduped);
  }

  return {
    rows: dedupeRows(allRows),
    diagnostics,
  };
}

export async function readGithubSourceFromFile(path: string) {
  const text = await readFile(path, "utf8");
  return safeJsonParse<GithubCatalogSource[]>(text, []);
}
