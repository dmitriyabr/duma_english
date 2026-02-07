import assert from "node:assert/strict";
import test from "node:test";
import { extractReferenceText, extractRequiredWords } from "./taskText";

test("extractRequiredWords parses words list without colon", () => {
  const words = extractRequiredWords("Use those words trees, clean, recycle, river");
  assert.deepEqual(words, ["trees", "clean", "recycle", "river"]);
});

test("extractRequiredWords parses target words label", () => {
  const words = extractRequiredWords("Target words: community, practice, recycle.");
  assert.deepEqual(words, ["community", "practice", "recycle"]);
});

test("extractReferenceText extracts quoted read aloud text", () => {
  const text = extractReferenceText("Read this aloud clearly: 'I learn English every day at school.'");
  assert.equal(text, "I learn English every day at school.");
});

test("extractReferenceText returns empty when no explicit text is provided", () => {
  const text = extractReferenceText("Read this short story about a team playing a game.");
  assert.equal(text, "");
});
