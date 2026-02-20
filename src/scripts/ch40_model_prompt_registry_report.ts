import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getModelPromptRegistry, getReleaseTag } from "@/lib/registry/modelPromptRegistry";

function parseStringFlag(argv: string[], flag: string) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  return argv[idx + 1] || null;
}

async function main() {
  const argv = process.argv.slice(2);
  const outputPath =
    parseStringFlag(argv, "--output") || "docs/reports/CH40_MODEL_PROMPT_REGISTRY.json";

  const registry = getModelPromptRegistry();
  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify(registry, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath: resolvedPath,
        releaseTag: getReleaseTag(),
        summary: {
          evaluatorModelVersion: registry.evaluatorModelVersion,
          causalInferenceModelVersion: registry.causalInferenceModelVersion,
          policyVersion: registry.policyVersion,
          rewardVersion: registry.rewardVersion,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
