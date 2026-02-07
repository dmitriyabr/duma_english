import "dotenv/config";
import { refreshGseCatalog } from "../lib/gse/catalog";
import { scrapeDescriptorNodes, scrapeVocabularyNodes } from "../lib/gse/officialApi";

const DEFAULT_VOCAB_URL = "https://www.english.com/gse/teacher-toolkit/user/api/v1/vocabulary/search?page=1";
const DEFAULT_GRAMMAR_URL =
  "https://www.english.com/gse/teacher-toolkit/user/api/v1/descriptors?filters=%7B%22gseRange%22:%7B%22from%22:%2210%22,%22to%22:%2290%22,%22hideEmpties%22:true%7D,%22syllabuses%22:%5B%7B%22syllabusId%22:%2254fe84e0070b48b42932d4c3%22,%22syllabusName%22:%22GLGR%22,%22description%22:%22Grammar%22%7D%5D,%22status%22:%5B%22published%22%5D,%22searchIn%22:%5B%22descriptor%22,%22additionalInformation.Grammatical+Categories%22,%22additionalInformation.Structure%22,%22additionalInformation.Variant+terms%22%5D%7D&offset=10&q=NOT+(No+corresponding+LOs+currently+published)&search-v2=true&sortBy=%7B%22property%22:%22gse%22,%22order%22:%22asc%22,%22urlParamName%22:%22gse%22%7D";
const DEFAULT_LO_URL =
  "https://www.english.com/gse/teacher-toolkit/user/api/v1/descriptors?filters=%7B%22gseRange%22:%7B%22from%22:%2210%22,%22to%22:%2290%22,%22hideEmpties%22:true%7D,%22syllabuses%22:%5B%7B%22syllabusId%22:%22675ad205424bf505774294a4%22,%22syllabusName%22:%22GL%22,%22description%22:%22Adult+Learners%22%7D%5D,%22status%22:%5B%22published%22%5D,%22searchIn%22:%5B%22descriptor%22,%22tags.tags.tagName%22,%22descriptiveId%22%5D%7D&offset=10&q=NOT+(No+corresponding+LOs+currently+published)&search-v2=true&sortBy=%7B%22property%22:%22gse%22,%22order%22:%22asc%22,%22urlParamName%22:%22gse%22%7D";

type Options = {
  version?: string;
  sourceVersion?: string;
  description?: string;
  vocabUrl: string;
  grammarUrl: string;
  loUrl: string;
  maxVocabPages?: number;
  vocabPageSize: number;
  maxGrammarOffsets?: number;
  maxLoOffsets?: number;
};

function parseNumberFlag(args: string[], flag: string): number | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return undefined;
  const raw = args[index + 1];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function parseStringFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function parseOptions(argv: string[]): Options {
  return {
    version: parseStringFlag(argv, "--version") || process.env.GSE_CATALOG_VERSION || undefined,
    sourceVersion:
      parseStringFlag(argv, "--source-version") || process.env.GSE_SOURCE_VERSION || new Date().toISOString().slice(0, 10),
    description: parseStringFlag(argv, "--description") || "Official Pearson API import",
    vocabUrl: parseStringFlag(argv, "--vocab-url") || process.env.GSE_VOCAB_URL || DEFAULT_VOCAB_URL,
    grammarUrl: parseStringFlag(argv, "--grammar-url") || process.env.GSE_GRAMMAR_URL || DEFAULT_GRAMMAR_URL,
    loUrl: parseStringFlag(argv, "--lo-url") || process.env.GSE_LO_URL || DEFAULT_LO_URL,
    maxVocabPages: parseNumberFlag(argv, "--max-vocab-pages"),
    vocabPageSize: parseNumberFlag(argv, "--vocab-page-size") || 500,
    maxGrammarOffsets: parseNumberFlag(argv, "--max-grammar-offsets"),
    maxLoOffsets: parseNumberFlag(argv, "--max-lo-offsets"),
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = Date.now();
  console.log("[gse:import:official] scraping vocabulary...");
  const vocabNodes = await scrapeVocabularyNodes(options.vocabUrl, options.maxVocabPages, options.vocabPageSize);
  console.log(`[gse:import:official] vocabulary nodes: ${vocabNodes.length}`);

  console.log("[gse:import:official] scraping grammar...");
  const grammarNodes = await scrapeDescriptorNodes(options.grammarUrl, "grammar", options.maxGrammarOffsets);
  console.log(`[gse:import:official] grammar nodes: ${grammarNodes.length}`);

  console.log("[gse:import:official] scraping learning objectives...");
  const loNodes = await scrapeDescriptorNodes(options.loUrl, "lo", options.maxLoOffsets);
  console.log(`[gse:import:official] learning objective nodes: ${loNodes.length}`);

  const officialRows = [...vocabNodes, ...grammarNodes, ...loNodes];
  console.log(`[gse:import:official] total mapped nodes: ${officialRows.length}`);

  const refreshResult = await refreshGseCatalog({
    version: options.version,
    description: options.description,
    sourceVersion: options.sourceVersion,
    officialRows,
  });

  const elapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedSec,
        mapped: {
          vocabulary: vocabNodes.length,
          grammar: grammarNodes.length,
          learningObjectives: loNodes.length,
          total: officialRows.length,
        },
        refresh: refreshResult,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[gse:import:official] ${message}`);
  process.exit(1);
});
