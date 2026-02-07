import "dotenv/config";
import { prisma } from "../lib/db";
import { buildGseQualityReport } from "../lib/gse/quality";

async function main() {
  const report = await buildGseQualityReport();
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[gse:qa] ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
