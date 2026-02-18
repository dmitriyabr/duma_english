import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/db";
import {
  buildDifficultyAnchorStabilityReport,
  type DifficultyCalibrationRow,
} from "../lib/ood/difficultyCalibration";

type CliOptions = {
  days: number;
  outputPath: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    days: 30,
    outputPath: null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--days=")) {
      const parsed = Number(arg.slice("--days=".length));
      if (Number.isFinite(parsed)) options.days = Math.max(7, Math.min(180, Math.round(parsed)));
      continue;
    }
    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (value) options.outputPath = path.resolve(process.cwd(), value);
      continue;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date();
  const from = new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);
  const rows = await prisma.taskInstance.findMany({
    where: {
      createdAt: { gte: from },
      estimatedDifficulty: { not: null },
    },
    select: {
      taskType: true,
      estimatedDifficulty: true,
      createdAt: true,
    },
  });

  const normalizedRows: DifficultyCalibrationRow[] = rows.map((row) => ({
    taskType: row.taskType,
    estimatedDifficulty: row.estimatedDifficulty,
    createdAt: row.createdAt,
  }));

  const { report, calibrationSet } = buildDifficultyAnchorStabilityReport({
    rows: normalizedRows,
    windowDays: options.days,
    now,
  });

  const payload = {
    report,
    calibrationSet,
  };

  const json = JSON.stringify(payload, null, 2);
  if (!options.outputPath) {
    console.log(json);
    return;
  }

  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, `${json}\n`, "utf8");
  console.log(`[ch14-calibration] report written to ${options.outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
