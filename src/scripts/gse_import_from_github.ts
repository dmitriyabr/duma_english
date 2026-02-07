import "dotenv/config";
import { refreshGseCatalog } from "../lib/gse/catalog";
import { GithubCatalogSource } from "../lib/gse/types";

type CliOptions = {
  version?: string;
  sourceVersion?: string;
  description?: string;
  repos: string[];
  includeToolkitBootstrap: boolean;
};

function parseArgValue(args: string[], key: string) {
  const idx = args.findIndex((arg) => arg === key);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string) {
  return args.includes(flag);
}

function parseCliOptions(argv: string[]): CliOptions {
  const reposArg =
    parseArgValue(argv, "--repos") || process.env.GSE_GITHUB_REPOS || "ruupert/gse_analyser,fildpauz/vocab-lists";
  const repos = reposArg
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
  return {
    repos,
    version: parseArgValue(argv, "--version") || process.env.GSE_CATALOG_VERSION,
    sourceVersion:
      parseArgValue(argv, "--source-version") || process.env.GSE_SOURCE_VERSION || new Date().toISOString().slice(0, 10),
    description: parseArgValue(argv, "--description") || "GitHub import (auto)",
    includeToolkitBootstrap: !hasFlag(argv, "--no-toolkit-bootstrap"),
  };
}

function toGithubSources(options: CliOptions): GithubCatalogSource[] {
  return options.repos.map((repoRef) => ({
    repo: repoRef,
    includeToolkitBootstrap: options.includeToolkitBootstrap,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseCliOptions(args);
  if (options.repos.length === 0) {
    throw new Error("No repositories provided. Use --repos owner/repo,owner/repo");
  }

  const result = await refreshGseCatalog({
    version: options.version,
    sourceVersion: options.sourceVersion,
    description: options.description,
    githubSources: toGithubSources(options),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[gse:import:github] ${message}`);
  process.exit(1);
});

