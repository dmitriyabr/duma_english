import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOURSE_PRAGMATICS_VERSION,
  adjudicateDiscoursePragmatics,
  evaluateDiscoursePragmatics,
  isDiscoursePragmaticsTaskType,
} from "./pragmatics";

test("isDiscoursePragmaticsTaskType detects discourse families", () => {
  assert.equal(isDiscoursePragmaticsTaskType("topic_talk"), true);
  assert.equal(isDiscoursePragmaticsTaskType("role_play"), true);
  assert.equal(isDiscoursePragmaticsTaskType("target_vocab"), false);
});

test("evaluateDiscoursePragmatics returns 5 rubric dimensions", () => {
  const assessment = evaluateDiscoursePragmatics({
    taskType: "topic_talk",
    taskPrompt: "Give a formal short presentation for your teacher.",
    transcript:
      "I think reading is important because it builds knowledge. For example, when I read daily, I learn faster. Therefore, we should read every day. In conclusion, reading helps everyone in our class.",
  });

  assert.equal(assessment.version, DISCOURSE_PRAGMATICS_VERSION);
  assert.equal(assessment.rubricChecks.length, 5);
  assert.ok(assessment.scores.argumentStructure >= 65);
  assert.ok(assessment.scores.cohesion >= 65);
});

test("adjudicateDiscoursePragmatics is stricter than model-facing scoring", () => {
  const base = evaluateDiscoursePragmatics({
    taskType: "role_play",
    taskPrompt: "Role-play a short conversation with your classmate.",
    transcript:
      "Hi, how are you? I think we should finish this together because we have homework. What do you think? Sorry, let me rephrase, can we do it now?",
  });
  const adjudicated = adjudicateDiscoursePragmatics({
    taskType: "role_play",
    taskPrompt: "Role-play a short conversation with your classmate.",
    transcript:
      "Hi, how are you? I think we should finish this together because we have homework. What do you think? Sorry, let me rephrase, can we do it now?",
  });

  assert.ok(adjudicated.overallScore <= base.overallScore);
  assert.ok(adjudicated.scores.turnTakingRepair <= base.scores.turnTakingRepair);
});
