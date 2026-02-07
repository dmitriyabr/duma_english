import test from "node:test";
import assert from "node:assert/strict";
import { computeNextMasteryScore } from "./gse/mastery";
import { mapTranscriptToWordSet } from "./gse/evidence";

test("mastery update is monotonic for positive evidence", () => {
  const current = 40;
  const medium = computeNextMasteryScore(current, {
    nodeId: "n1",
    confidence: 0.7,
    impact: 0.5,
    reliability: "medium",
  });
  const high = computeNextMasteryScore(current, {
    nodeId: "n1",
    confidence: 0.9,
    impact: 0.8,
    reliability: "high",
  });
  assert.ok(medium > current);
  assert.ok(high > medium);
});

test("transcript->word set mapper dedupes and normalizes", () => {
  const words = mapTranscriptToWordSet("Hello, hello! My FRIEND learns.");
  assert.ok(words.includes("hello"));
  assert.ok(words.includes("friend"));
  assert.ok(words.includes("learns"));
  assert.equal(words.filter((word) => word === "hello").length, 1);
});

