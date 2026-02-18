import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildShadowPolicyDashboard } from "../lib/quality/shadowPolicyDashboard";
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
  const outputPath = parseStringFlag(argv, "--output");
  const minTracedDecisions = Math.max(0, Math.floor(parseNumberFlag(argv, "--min-traced-decisions") ?? 0));
  const maxDisagreementRate = Math.max(0, Math.min(1, parseNumberFlag(argv, "--max-disagreement-rate") ?? 1));

  const report = await buildShadowPolicyDashboard({
    windowDays,
    limit,
  });

  if (outputPath) {
    const resolvedPath = resolve(outputPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, JSON.stringify(report, null, 2), "utf8");
  }

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));

  if (report.tracedDecisions < minTracedDecisions) {
    console.error(
      `[ch22] tracedDecisions ${report.tracedDecisions} below min ${minTracedDecisions}`
    );
    process.exitCode = 1;
  }

  if (report.disagreementRate > maxDisagreementRate) {
    console.error(
      `[ch22] disagreementRate ${report.disagreementRate.toFixed(4)} exceeds max ${maxDisagreementRate.toFixed(4)}`
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
