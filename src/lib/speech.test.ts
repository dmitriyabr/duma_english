import test from "node:test";
import assert from "node:assert/strict";
import { parseAzureResponseToMetrics, type AzureRecognitionResponse } from "./speech";

test("parseAzureResponseToMetrics reads top-level pronunciation scores", () => {
  const response: AzureRecognitionResponse = {
    RecognitionStatus: "Success",
    Duration: 33_600_000,
    NBest: [
      {
        Display: "I like going to school because I learn new things.",
        Confidence: 0.98,
        PronScore: 92.4,
        AccuracyScore: 93,
        FluencyScore: 99,
        CompletenessScore: 100,
        ProsodyScore: 85.1,
        Words: [{ Word: "I" }, { Word: "like" }],
      },
    ],
  };

  const parsed = parseAzureResponseToMetrics(response, 20, "target_ref");
  assert.equal(parsed.metrics.pronunciation, 92.4);
  assert.equal(parsed.metrics.accuracy, 93);
  assert.equal(parsed.metrics.fluency, 99);
  assert.equal(parsed.metrics.completeness, 100);
  assert.equal(parsed.metrics.prosody, 85.1);
  assert.equal(parsed.metrics.pronunciationTargetRef, 92.4);
});

test("parseAzureResponseToMetrics can tag self-reference pronunciation", () => {
  const response: AzureRecognitionResponse = {
    DisplayText: "Fallback transcript",
    NBest: [{ Display: "Fallback transcript", PronScore: 77 }],
  };

  const parsed = parseAzureResponseToMetrics(response, 17, "self_ref");
  assert.equal(parsed.metrics.pronunciationSelfRef, 77);
  assert.equal(parsed.transcript, "Fallback transcript");
});
