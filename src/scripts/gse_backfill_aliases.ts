import "dotenv/config";
import { prisma } from "../lib/db";

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

function collectAliases(params: {
  descriptor: string;
  sourceKey: string;
  metadataJson: unknown;
}) {
  const aliases = new Set<string>();
  const candidates = [
    params.descriptor,
    looksLikeLexeme(params.sourceKey) ? params.sourceKey : "",
    ...variantStrings(params.metadataJson),
  ];
  for (const value of candidates) {
    const normalized = normalizeAlias(value);
    if (!normalized) continue;
    aliases.add(normalized);
    for (const token of tokenAliases(normalized)) {
      for (const infl of inflections(token)) aliases.add(infl);
    }
  }
  return Array.from(aliases).filter((alias) => alias.length >= 2 && alias.length <= 80);
}

async function main() {
  const batchSize = 1200;
  let cursorId: string | null = null;
  let processed = 0;
  let inserted = 0;

  console.log("[gse:aliases] clearing auto aliases...");
  await prisma.gseNodeAlias.deleteMany({ where: { source: "auto" } });

  for (;;) {
    const nodes: Array<{
      id: string;
      nodeId: string;
      descriptor: string;
      sourceKey: string;
      metadataJson: unknown;
    }> = await prisma.gseNode.findMany({
      where: {
        type: { in: ["GSE_VOCAB", "GSE_GRAMMAR", "GSE_LO"] },
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        nodeId: true,
        descriptor: true,
        sourceKey: true,
        metadataJson: true,
      },
    });
    if (nodes.length === 0) break;
    cursorId = nodes[nodes.length - 1].id;
    processed += nodes.length;

    const rows: Array<{ nodeId: string; alias: string; source: string }> = [];
    for (const node of nodes) {
      const aliases = collectAliases({
        descriptor: node.descriptor,
        sourceKey: node.sourceKey,
        metadataJson: node.metadataJson,
      });
      for (const alias of aliases) {
        rows.push({
          nodeId: node.nodeId,
          alias,
          source: "auto",
        });
      }
    }

    if (rows.length > 0) {
      const result = await prisma.gseNodeAlias.createMany({
        data: rows,
        skipDuplicates: true,
      });
      inserted += result.count;
    }
    console.log(`[gse:aliases] processed=${processed}, inserted=${inserted}`);
  }

  console.log(JSON.stringify({ ok: true, processedNodes: processed, insertedAliases: inserted }, null, 2));
}

main()
  .catch((error) => {
    console.error("[gse:aliases] failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
