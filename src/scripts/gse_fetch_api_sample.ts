/**
 * Fetch a small sample from GSE official API and save raw JSON to inspect
 * relatedDescriptors / relatedLOs / grammaticalCategories structure.
 * Run: npx tsx src/scripts/gse_fetch_api_sample.ts
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const GRAMMAR_URL =
  "https://www.english.com/gse/teacher-toolkit/user/api/v1/descriptors?filters=%7B%22gseRange%22:%7B%22from%22:%2210%22,%22to%22:%2290%22,%22hideEmpties%22:true%7D,%22syllabuses%22:%5B%7B%22syllabusId%22:%2254fe84e0070b48b42932d4c3%22,%22syllabusName%22:%22GLGR%22,%22description%22:%22Grammar%22%7D%5D,%22status%22:%5B%22published%22%5D,%22searchIn%22:%5B%22descriptor%22,%22additionalInformation.Grammatical+Categories%22,%22additionalInformation.Structure%22,%22additionalInformation.Variant+terms%22%5D%7D&offset=0&q=NOT+(No+corresponding+LOs+currently+published)&search-v2=true&sortBy=%7B%22property%22:%22gse%22,%22order%22:%22asc%22,%22urlParamName%22:%22gse%22%7D";
const LO_URL =
  "https://www.english.com/gse/teacher-toolkit/user/api/v1/descriptors?filters=%7B%22gseRange%22:%7B%22from%22:%2210%22,%22to%22:%2290%22,%22hideEmpties%22:true%7D,%22syllabuses%22:%5B%7B%22syllabusId%22:%22675ad205424bf505774294a4%22,%22syllabusName%22:%22GL%22,%22description%22:%22Adult+Learners%22%7D%5D,%22status%22:%5B%22published%22%5D,%22searchIn%22:%5B%22descriptor%22,%22tags.tags.tagName%22,%22descriptiveId%22%5D%7D&offset=0&q=NOT+(No+corresponding+LOs+currently+published)&search-v2=true&sortBy=%7B%22property%22:%22gse%22,%22order%22:%22asc%22,%22urlParamName%22:%22gse%22%7D";
const VOCAB_URL = "https://www.english.com/gse/teacher-toolkit/user/api/v1/vocabulary/search?page=1&size=50";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "duma-english-official-api-scraper", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  const outDir = join(process.cwd(), "scripts", "data");
  mkdirSync(outDir, { recursive: true });

  console.log("Fetching grammar descriptors (offset=0)...");
  const grammar = await fetchJson<{ count?: number; data?: unknown[] }>(
    GRAMMAR_URL.replace("offset=0", "offset=0")
  );
  const grammarData = Array.isArray(grammar.data) ? grammar.data : [];
  console.log(`  count: ${grammar.count}, items: ${grammarData.length}`);

  console.log("Fetching LO descriptors (offset=0)...");
  const lo = await fetchJson<{ count?: number; data?: unknown[] }>(LO_URL);
  const loData = Array.isArray(lo.data) ? lo.data : [];
  console.log(`  count: ${lo.count}, items: ${loData.length}`);

  console.log("Fetching vocabulary (page=1, size=50)...");
  const vocab = await fetchJson<{ count?: number; data?: unknown[] }>(VOCAB_URL);
  const vocabData = Array.isArray(vocab.data) ? vocab.data : [];
  console.log(`  count: ${vocab.count}, items: ${vocabData.length}`);

  const sample = {
    fetchedAt: new Date().toISOString(),
    grammar: { totalCount: grammar.count, items: grammarData.slice(0, 15) },
    lo: { totalCount: lo.count, items: loData.slice(0, 15) },
    vocab: { totalCount: vocab.count, items: vocabData.slice(0, 10) },
  };

  const path = join(outDir, "gse_api_sample.json");
  writeFileSync(path, JSON.stringify(sample, null, 2), "utf8");
  console.log(`\nWritten: ${path}`);

  const firstGrammar = grammarData[0] as Record<string, unknown> | undefined;
  const firstLo = loData[0] as Record<string, unknown> | undefined;
  const firstVocab = vocabData[0] as Record<string, unknown> | undefined;

  console.log("\n--- First grammar item keys ---");
  console.log(Object.keys(firstGrammar || {}));
  if (firstGrammar?.relatedDescriptors !== undefined)
    console.log("relatedDescriptors:", JSON.stringify(firstGrammar.relatedDescriptors).slice(0, 200));
  if (firstGrammar?.relatedLOs !== undefined)
    console.log("relatedLOs:", JSON.stringify(firstGrammar.relatedLOs).slice(0, 300));

  console.log("\n--- First LO item keys ---");
  console.log(Object.keys(firstLo || {}));
  if (firstLo?.relatedDescriptors !== undefined)
    console.log("relatedDescriptors:", JSON.stringify(firstLo.relatedDescriptors).slice(0, 200));
  if (firstLo?.relatedLOs !== undefined)
    console.log("relatedLOs:", JSON.stringify(firstLo.relatedLOs).slice(0, 300));

  console.log("\n--- First vocab item keys ---");
  console.log(Object.keys(firstVocab || {}));
  if (firstVocab?.grammaticalCategories !== undefined)
    console.log("grammaticalCategories:", JSON.stringify(firstVocab.grammaticalCategories));
  if (firstVocab?.topics !== undefined)
    console.log("topics (preview):", JSON.stringify(firstVocab.topics).slice(0, 200));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
