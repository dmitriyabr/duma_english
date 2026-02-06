import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyCycle, getCurriculumWeek, getSkillMatrix } from "./curriculum";

test("skill matrix returns CEFR targets and expected response length", () => {
  const matrix = getSkillMatrix("A1", "9-11");
  assert.equal(matrix.stage, "A1");
  assert.equal(matrix.ageBand, "9-11");
  assert.ok(matrix.expectedResponseLength.length > 0);
  assert.ok(matrix.targets.vocabulary.length > 0);
});

test("curriculum week stays in 1..12 and includes focus skills", () => {
  const week = getCurriculumWeek({ stage: "A2", ageBand: "12-14", week: 14 });
  assert.equal(week.week, 12);
  assert.ok(week.focusSkills.length > 0);
  assert.ok(week.taskBlueprints.length > 0);
});

test("weekly cycle builds exactly 12 nodes", () => {
  const cycle = buildWeeklyCycle("A0", "6-8");
  assert.equal(cycle.length, 12);
  assert.equal(cycle[0].week, 1);
  assert.equal(cycle[11].week, 12);
});
