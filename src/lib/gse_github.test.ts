import test from "node:test";
import assert from "node:assert/strict";
import { mapToolkitVocabularyItem, parseGithubRepoRef } from "./gse/github";

test("parseGithubRepoRef supports short and full formats", () => {
  const shortRef = parseGithubRepoRef("ruupert/gse_analyser");
  assert.equal(shortRef?.owner, "ruupert");
  assert.equal(shortRef?.repo, "gse_analyser");
  assert.equal(shortRef?.ref, "main");

  const fullRef = parseGithubRepoRef("https://github.com/fildpauz/vocab-lists/tree/master");
  assert.equal(fullRef?.owner, "fildpauz");
  assert.equal(fullRef?.repo, "vocab-lists");
  assert.equal(fullRef?.ref, "master");
});

test("mapToolkitVocabularyItem normalizes vocabulary row", () => {
  const mapped = mapToolkitVocabularyItem({
    expression: "learn new things",
    gse: "52",
    cefr: "B1+ (51-58)",
    grammaticalCategories: ["phrase", "verb"],
    topics: [
      [{ id: "1", description: "School" }],
      [{ id: "2", description: "Learning" }],
    ],
  });
  assert.ok(mapped);
  assert.equal(mapped?.word, "learn new things");
  assert.equal(mapped?.gse, 52);
  assert.equal(mapped?.cefr, "B1+ (51-58)");
  assert.deepEqual(mapped?.categories, ["phrase", "verb"]);
  assert.deepEqual(mapped?.topics, ["School", "Learning"]);
});

