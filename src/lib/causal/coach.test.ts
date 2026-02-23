import test from "node:test";
import assert from "node:assert/strict";
import { buildChildCausalCoach } from "./coach";

test("buildChildCausalCoach returns mapped card for known cause", () => {
  const card = buildChildCausalCoach("rule_confusion");
  assert.equal(card.reasonTitle, "Rule mix-up");
  assert.equal(card.nextAction.includes("grammar"), true);
});

test("buildChildCausalCoach falls back to default for unknown label", () => {
  const card = buildChildCausalCoach("something_else");
  assert.equal(card.reasonTitle, "Almost there");
});

