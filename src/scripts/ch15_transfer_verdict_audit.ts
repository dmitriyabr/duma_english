import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildTransferVerdictDashboard } from "../lib/quality/transferVerdictDashboard";
import { prisma } from "../lib/db";

function parseNumberFlag(argv: string[], flag: string) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const raw = argv[idx + 1];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStringFlag(argv: string[], flag: string) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  return argv[idx + 1] || null;
}

async function main() {
  const argv = process.argv.slice(2);
  const windowDays = Math.max(1, Math.min(365, Math.floor(parseNumberFlag(argv, "--window-days") ?? 30)));
  const limit = Math.max(10, Math.min(50000, Math.floor(parseNumberFlag(argv, "--limit") ?? 5000)));
  const maxProtocolViolations = Math.max(0, Math.floor(parseNumberFlag(argv, "--max-protocol-violations") ?? 0));
  const outputPath = parseStringFlag(argv, "--output");

  const report = await buildTransferVerdictDashboard({ windowDays, limit });

  if (outputPath) {
    const resolvedPath = resolve(outputPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, JSON.stringify(report, null, 2), "utf8");
  }

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));

  if (report.protocolViolationCount > maxProtocolViolations) {
    console.error(
      `[ch15] protocol violations ${report.protocolViolationCount} exceed max ${maxProtocolViolations}`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
