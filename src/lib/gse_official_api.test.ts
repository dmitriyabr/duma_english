import test from "node:test";
import assert from "node:assert/strict";
import { mapDescriptorApiItemToNode, mapVocabularyApiItemToNode } from "./gse/officialApi";

test("mapVocabularyApiItemToNode uses atomic itemId as sourceKey", () => {
  const node = mapVocabularyApiItemToNode({
    itemId: "abc-123",
    expression: "avoid judgment",
    gse: "54",
    cefr: "B1+ (51-58)",
    grammaticalCategories: ["phrase"],
    audience: "SSGL",
  });
  assert.ok(node);
  assert.equal(node?.sourceKey, "abc-123");
  assert.equal(node?.type, "GSE_VOCAB");
  assert.equal(node?.gseCenter, 54);
});

test("mapDescriptorApiItemToNode extracts gse from tags and maps grammar type", () => {
  const node = mapDescriptorApiItemToNode(
    {
      descriptorId: "55af74f1d6c1560c41c6a0b6",
      descriptiveId: "GLGR0083A",
      descriptor: "Can use common forms of 'have' in the present tense.",
      syllabuses: [{ syllabusName: "GLGR", syllabusId: "54fe84e0070b48b42932d4c3" }],
      tags: [
        { tagTypeId: "CEFR", tags: [{ tagName: "A1 (22-29)" }] },
        { tagTypeId: "SKL", tags: [{ tagName: "Grammar" }] },
      ],
      gse: [{ tagTypeId: "GSE", tags: [{ tagName: "22", tagId: "GSE00025" }] }],
      additionalInformation: { "Grammatical Categories": "Verb>Tense" },
    },
    "grammar"
  );
  assert.ok(node);
  assert.equal(node?.sourceKey, "55af74f1d6c1560c41c6a0b6");
  assert.equal(node?.type, "GSE_GRAMMAR");
  assert.equal(node?.gseCenter, 22);
  assert.equal(node?.cefrBand, "A1 (22-29)");
});

