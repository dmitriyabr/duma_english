import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mergeAndDedupeNodes } from "./merge";
import { buildStableNodeId, stableHash } from "./utils";
import {
  GseCatalogRefreshInput,
  GseRawNode,
} from "./types";
import {
  normalizeGithubVocabRows,
  parseGithubScraperRows,
  parseOfficialCsvRows,
  parseOfficialPdfRows,
  parseOfficialXlsxRows,
} from "./importers";
import { importGseRowsFromGithub } from "./github";

function buildCatalogVersion(input: GseCatalogRefreshInput) {
  if (input.version && input.version.trim().length > 0) return input.version.trim();
  const now = new Date();
  return `gse-${now.toISOString().slice(0, 10)}`;
}

function normalizeAlias(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "from",
  "have",
  "this",
  "they",
  "were",
  "been",
  "your",
  "about",
  "there",
  "then",
  "into",
  "than",
  "them",
  "very",
  "just",
  "like",
]);

function looksLikeLexeme(value: string) {
  const normalized = normalizeAlias(value);
  return /^[a-z][a-z0-9' -]{1,48}$/.test(normalized) && !normalized.includes("ua8444");
}

function tokenAliases(value: string) {
  return normalizeAlias(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !ALIAS_STOPWORDS.has(token));
}

function inflections(token: string) {
  if (!/^[a-z][a-z'-]{1,30}$/.test(token)) return [];
  const set = new Set<string>([token]);
  if (token.endsWith("y") && token.length > 3) set.add(`${token.slice(0, -1)}ies`);
  if (token.endsWith("s") || token.endsWith("x") || token.endsWith("z") || token.endsWith("ch") || token.endsWith("sh")) {
    set.add(`${token}es`);
  } else {
    set.add(`${token}s`);
  }
  if (token.length > 4) {
    set.add(`${token}ed`);
    set.add(`${token}ing`);
  }
  return Array.from(set);
}

function variantStrings(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return [];
  const row = metadata as Record<string, unknown>;
  const variants = row.variants;
  if (!Array.isArray(variants)) return [];
  const values: string[] = [];
  for (const variant of variants) {
    if (typeof variant === "string") {
      values.push(variant);
      continue;
    }
    if (!variant || typeof variant !== "object") continue;
    for (const key of ["value", "variant", "name", "term", "label", "description"]) {
      const raw = (variant as Record<string, unknown>)[key];
      if (typeof raw === "string" && raw.trim().length > 0) values.push(raw);
    }
  }
  return values;
}

function collectNodeAliases(node: GseRawNode) {
  const values = new Set<string>();
  const candidates = [
    node.descriptor,
    looksLikeLexeme(node.sourceKey) ? node.sourceKey : "",
    ...variantStrings(node.metadata),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeAlias(candidate);
    if (!normalized) continue;
    values.add(normalized);
    for (const token of tokenAliases(normalized)) {
      for (const item of inflections(token)) values.add(item);
    }
  }
  return Array.from(values).filter((alias) => alias.length >= 2 && alias.length <= 80);
}

async function collectNodes(input: GseCatalogRefreshInput): Promise<{
  nodes: GseRawNode[];
  githubImportDiagnostics: Array<{
    repo: string;
    filesScanned: number;
    rowsImported: number;
    usedToolkitBootstrap: boolean;
    notes: string[];
  }>;
}> {
  const collected: GseRawNode[] = [];
  const githubImportDiagnostics: Array<{
    repo: string;
    filesScanned: number;
    rowsImported: number;
    usedToolkitBootstrap: boolean;
    notes: string[];
  }> = [];
  if (Array.isArray(input.officialRows) && input.officialRows.length > 0) {
    collected.push(...input.officialRows);
  }

  if (input.officialCsv && input.officialCsv.trim().length > 0) {
    collected.push(...parseOfficialCsvRows(input.officialCsv));
  }

  if (input.officialXlsxBase64 && input.officialXlsxBase64.trim().length > 0) {
    const buffer = Buffer.from(input.officialXlsxBase64, "base64");
    const parsed = await parseOfficialXlsxRows(buffer);
    collected.push(...parsed);
  }

  if (input.officialPdfBase64 && input.officialPdfBase64.trim().length > 0) {
    const buffer = Buffer.from(input.officialPdfBase64, "base64");
    const parsed = await parseOfficialPdfRows(buffer);
    collected.push(...parsed);
  }

  if (Array.isArray(input.githubVocabRows) && input.githubVocabRows.length > 0) {
    collected.push(...normalizeGithubVocabRows(input.githubVocabRows));
  }

  if (Array.isArray(input.githubSources) && input.githubSources.length > 0) {
    const imported = await importGseRowsFromGithub(input.githubSources);
    collected.push(...normalizeGithubVocabRows(imported.rows));
    githubImportDiagnostics.push(...imported.diagnostics);
  }

  return { nodes: collected, githubImportDiagnostics };
}

export async function refreshGseCatalog(input: GseCatalogRefreshInput) {
  const version = buildCatalogVersion(input);
  const { nodes: rawNodes, githubImportDiagnostics } = await collectNodes(input);
  const merged = mergeAndDedupeNodes(rawNodes);

  const catalogVersion = await prisma.gseCatalogVersion.upsert({
    where: { version },
    update: {
      source: "hybrid",
      description: input.description || null,
      metadataJson: {
        sourceVersion: input.sourceVersion || null,
        importedAt: new Date().toISOString(),
      },
    },
    create: {
      version,
      source: "hybrid",
      description: input.description || null,
      metadataJson: {
        sourceVersion: input.sourceVersion || null,
        importedAt: new Date().toISOString(),
      },
    },
  });

  let created = 0;
  let updated = 0;
  await prisma.gseNodeAlias.deleteMany({ where: { source: "auto" } });
  for (const node of merged) {
    const nodeId = buildStableNodeId(node);
    const existing = await prisma.gseNode.findUnique({ where: { nodeId } });
    const payload: Prisma.GseNodeUncheckedCreateInput = {
      nodeId,
      sourceKey: node.sourceKey || stableHash(node.descriptor),
      type: node.type,
      catalog: node.catalog,
      gseMin: node.gseMin ?? null,
      gseMax: node.gseMax ?? null,
      gseCenter: node.gseCenter ?? null,
      cefrBand: node.cefrBand ?? null,
      audience: node.audience ?? null,
      skill: node.skill ?? null,
      descriptor: node.descriptor,
      source: node.source,
      sourceVersion: node.sourceVersion ?? input.sourceVersion ?? null,
      licenseTag: node.licenseTag ?? null,
      metadataJson: (node.metadata || {}) as Prisma.InputJsonValue,
      catalogVersionId: catalogVersion.id,
    };

    if (!existing) {
      await prisma.gseNode.create({ data: payload });
      created += 1;
    } else {
      await prisma.gseNode.update({
        where: { nodeId },
        data: {
          ...payload,
          id: undefined,
        },
      });
      updated += 1;
    }

    const aliases = collectNodeAliases(node);
    if (aliases.length > 0) {
      await prisma.gseNodeAlias.createMany({
        data: aliases.map((alias) => ({
          nodeId,
          alias,
          source: "auto",
        })),
        skipDuplicates: true,
      });
    }
  }

  return {
    version: catalogVersion.version,
    catalogVersionId: catalogVersion.id,
    imported: merged.length,
    created,
    updated,
    githubImportDiagnostics,
  };
}

export function normalizeGithubPayload(input: unknown) {
  if (!Array.isArray(input)) return [];
  const rows = parseGithubScraperRows(input as Array<Record<string, unknown>>);
  return normalizeGithubVocabRows(rows);
}
