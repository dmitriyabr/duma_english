import assert from "node:assert/strict";
import test from "node:test";
import {
  TOPIC_RETRY_REASON_CODE,
  evaluateTopicRetryHeuristic,
  mapTopicVerdictToDecision,
} from "./topicRetryGate";

test("topic heuristic keeps short answers unblocked", () => {
  const decision = evaluateTopicRetryHeuristic({
    taskType: "topic_talk",
    taskPrompt: "Tell me about your school day.",
    transcript: "School is good.",
    taskMeta: null,
  });
  assert.equal(decision.shouldRetry, false);
});

test("topic heuristic keeps answer when opening sentence is on-topic", () => {
  const decision = evaluateTopicRetryHeuristic({
    taskType: "topic_talk",
    taskPrompt: "Tell me about your school day and favorite lesson.",
    transcript:
      "My school day starts early and my favorite lesson is science. Later I talk about my games and cartoons.",
    taskMeta: null,
  });
  assert.equal(decision.shouldRetry, false);
});

test("topic heuristic retries read-aloud when transcript mismatches reference", () => {
  const decision = evaluateTopicRetryHeuristic({
    taskType: "read_aloud",
    taskPrompt: "Read this sentence aloud.",
    transcript:
      "Yesterday the football match was amazing and we watched it with neighbors near the park.",
    taskMeta: {
      referenceText: "I learn English every day at school with my best friend.",
    },
  });
  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.reasonCode, TOPIC_RETRY_REASON_CODE);
});

test("topic verdict mapping blocks only high-confidence unrelated opening", () => {
  const retry = mapTopicVerdictToDecision({
    shouldRetry: true,
    confidence: 0.92,
    openingOnTopic: false,
  });
  assert.equal(retry.shouldRetry, true);
  assert.equal(retry.reasonCode, TOPIC_RETRY_REASON_CODE);

  const keepStartedOnTopic = mapTopicVerdictToDecision({
    shouldRetry: true,
    confidence: 0.95,
    openingOnTopic: true,
  });
  assert.equal(keepStartedOnTopic.shouldRetry, false);

  const keepLowConfidence = mapTopicVerdictToDecision({
    shouldRetry: true,
    confidence: 0.61,
    openingOnTopic: false,
  });
  assert.equal(keepLowConfidence.shouldRetry, false);
});
