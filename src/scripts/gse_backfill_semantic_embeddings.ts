import "dotenv/config";
import { prisma } from "../lib/db";
import { backfillSemanticEmbeddings } from "../lib/gse/semanticAssessor";

function hasFlag(flag: string) {
  return process.argv.slice(2).includes(flag);
}

async function main() {
  const includeAll = hasFlag("--all");
  const result = await backfillSemanticEmbeddings({ includeAll });
  console.log(JSON.stringify({ ok: true, includeAll, ...result }, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[gse:embeddings:backfill] ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
