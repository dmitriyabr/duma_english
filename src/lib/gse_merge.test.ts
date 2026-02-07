import test from "node:test";
import assert from "node:assert/strict";
import { buildStableNodeId } from "./gse/utils";
import { mergeAndDedupeNodes } from "./gse/merge";
import { GseRawNode } from "./gse/types";

test("GSE nodeId is stable for same source key", () => {
  const input: GseRawNode = {
    type: "GSE_VOCAB",
    catalog: "gse_yl",
    sourceKey: "learn",
    descriptor: "learn",
    gseMin: 30,
    gseMax: 30,
    source: "official",
  };
  const a = buildStableNodeId(input);
  const b = buildStableNodeId({ ...input, descriptor: "learn " });
  assert.equal(a, b);
});

test("merge prefers official row over github-derived on dedupe conflict", () => {
  const githubNode: GseRawNode = {
    type: "GSE_VOCAB",
    catalog: "gse_vocab",
    sourceKey: "friend",
    descriptor: "friend",
    gseMin: 26,
    gseMax: 26,
    source: "github_derived",
  };
  const officialNode: GseRawNode = {
    ...githubNode,
    source: "official",
    metadata: { topic: "school" },
  };
  const merged = mergeAndDedupeNodes([githubNode, officialNode]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "official");
});

