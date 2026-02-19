import assert from "node:assert/strict";
import test from "node:test";
import {
  extractListeningQuestion,
  extractListeningScript,
  extractReadingPassage,
  extractReadingQuestion,
  extractReferenceText,
  extractRequiredWords,
} from "./taskText";

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

test("extractReadingPassage reads Passage section", () => {
  const passage = extractReadingPassage(
    "Read the passage and answer.\nPassage: Amina reads every evening to grow her vocabulary.\nQuestion: Why does Amina read every evening?"
  );
  assert.equal(passage, "Amina reads every evening to grow her vocabulary.");
});

test("extractReadingQuestion reads Question section", () => {
  const question = extractReadingQuestion(
    "Read and answer.\nPassage: School gardens help students learn science.\nQuestion: How does the school garden help students?"
  );
  assert.equal(question, "How does the school garden help students?");
});

test("extractListeningScript reads Audio section", () => {
  const script = extractListeningScript(
    "Listen and answer.\nAudio: Ben missed the bus, so he called his teacher before class.\nQuestion: Why did Ben call his teacher?"
  );
  assert.equal(script, "Ben missed the bus, so he called his teacher before class.");
});

test("extractListeningQuestion reads Question section", () => {
  const question = extractListeningQuestion(
    "Listening task.\nAudio: Maya forgot her notebook and borrowed one from a classmate.\nQuestion: What did Maya borrow?"
  );
  assert.equal(question, "What did Maya borrow?");
});
