import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  REWARD_CONFIG_REGISTRY,
  REWARD_FUNCTION_VERSION_V1,
  evaluateCompositeReward,
} from "../lib/reward/function";

function parseStringFlag(argv: string[], flag: string) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  return argv[idx + 1] || null;
}

function computeHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const argv = process.argv.slice(2);
  const outputPath = parseStringFlag(argv, "--output");
  const rewardVersion = REWARD_FUNCTION_VERSION_V1;

  const replaySignals = [
    {
      masteryDeltaTotal: 3.2,
      transferVerdict: "transfer_pass" as const,
      retentionOutcome: "none" as const,
      taskScore: 81,
      transcriptConfidence: 0.86,
      recoveryTriggered: false,
    },
    {
      masteryDeltaTotal: -1.1,
      transferVerdict: "transfer_fail_validated" as const,
      retentionOutcome: "none" as const,
      taskScore: 49,
      transcriptConfidence: 0.54,
      recoveryTriggered: true,
    },
    {
      masteryDeltaTotal: 0.8,
      transferVerdict: null,
      retentionOutcome: "none" as const,
      taskScore: 68,
      transcriptConfidence: 0.73,
      recoveryTriggered: false,
    },
  ];

  const firstRun = replaySignals.map((signals) =>
    evaluateCompositeReward({ rewardVersion, signals })
  );
  const secondRun = replaySignals.map((signals) =>
    evaluateCompositeReward({ rewardVersion, signals })
  );
  const firstHash = computeHash(firstRun);
  const secondHash = computeHash(secondRun);

  const report = {
    generatedAt: new Date().toISOString(),
    rewardVersion,
    rewardConfig: REWARD_CONFIG_REGISTRY[rewardVersion],
    replaySampleCount: replaySignals.length,
    reproducibility: {
      deterministic: firstHash === secondHash,
      firstHash,
      secondHash,
    },
    replayRewards: firstRun,
  };

  if (outputPath) {
    const resolvedPath = resolve(outputPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, JSON.stringify(report, null, 2), "utf8");
  }

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
