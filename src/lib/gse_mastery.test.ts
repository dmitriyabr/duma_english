import test from "node:test";
import assert from "node:assert/strict";
import { computeDecayedMastery, computeNextMasteryScore } from "./gse/mastery";
import { mapTranscriptToWordSet } from "./gse/evidence";

test("mastery update is monotonic for positive evidence", () => {
  const current = 40;
  const medium = computeNextMasteryScore(current, {
    nodeId: "n1",
    confidence: 0.7,
    reliability: "medium",
  });
  const high = computeNextMasteryScore(current, {
    nodeId: "n1",
    confidence: 0.9,
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

test("decay lowers mastery over time based on half-life", () => {
  const now = new Date("2026-02-07T12:00:00.000Z");
  const old = new Date("2026-01-24T12:00:00.000Z");
  const decayed = computeDecayedMastery({
    masteryMean: 80,
    lastEvidenceAt: old,
    now,
    halfLifeDays: 14,
    evidenceCount: 1,
    reliability: "medium",
  });
  assert.ok(decayed < 80);
  assert.ok(decayed > 0);
});
