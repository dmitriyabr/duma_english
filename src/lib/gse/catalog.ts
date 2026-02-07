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
