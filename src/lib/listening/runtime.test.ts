import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTENING_RUNTIME_VERSION,
  buildListeningRuntimePayload,
  parseListeningRuntimeMeta,
} from "./runtime";

test("buildListeningRuntimePayload removes visible script from prompt", () => {
  const payload = buildListeningRuntimePayload({
    taskId: "task_123",
    prompt:
      "Listen and answer.\nAudio: Ben missed the bus, so he called his teacher before class to explain he would be late.\nQuestion: Why did Ben call his teacher before class?",
  });

  assert.equal(payload.visiblePrompt.includes("Audio:"), false);
  assert.equal(payload.visiblePrompt.includes("Ben missed the bus"), false);
  assert.equal(
    payload.visiblePrompt,
    "Listen to the audio and answer.\nQuestion: Why did Ben call his teacher before class?",
  );
  assert.equal(payload.hiddenScript.includes("Ben missed the bus"), true);
  assert.equal(payload.listeningPayload.assetId, "task_123");
  assert.equal(payload.listeningPayload.audioUrl, "/api/listening/assets/task_123");
});

test("parseListeningRuntimeMeta parses normalized task meta", () => {
  const parsed = parseListeningRuntimeMeta({
    modality: "listening",
    listeningScript: "Nora forgot her homework and asked her classmate for help.",
    listeningQuestion: "What did Nora do after she forgot her homework?",
    listeningAsset: {
      assetId: "task_xyz",
      durationSec: 11,
      runtimeVersion: LISTENING_RUNTIME_VERSION,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed?.asset.assetId, "task_xyz");
  assert.equal(parsed?.asset.durationSec, 11);
  assert.equal(parsed?.script.includes("Nora forgot"), true);
});
