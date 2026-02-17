import assert from "node:assert/strict";
import test from "node:test";
import {
  CEFR_COVERAGE_MATRIX,
  CEFR_COVERAGE_SKILLS,
  CEFR_COVERAGE_STAGE_ORDER,
  buildCefrCoverageReport,
  cefrCoverageMatrixSchema,
} from "./cefrCoverageMatrix";

test("cefr coverage matrix matches contract schema", () => {
  const parsed = cefrCoverageMatrixSchema.parse(CEFR_COVERAGE_MATRIX);
  assert.equal(parsed.version, CEFR_COVERAGE_MATRIX.version);
  assert.equal(parsed.descriptorRows.length, CEFR_COVERAGE_STAGE_ORDER.length * CEFR_COVERAGE_SKILLS.length);
});

test("cefr coverage report has no release-blocking gaps", () => {
  const report = buildCefrCoverageReport();
  assert.equal(
    report.summary.releaseBlocker,
    false,
    `Coverage gaps found:\n${JSON.stringify(report.gaps, null, 2)}`
  );
  assert.equal(report.summary.totalGaps, 0);
  assert.equal(report.summary.descriptorRows, report.summary.expectedDescriptorRows);
});

test("cefr coverage validator flags duplicate and missing stage/skill mappings", () => {
  const broken = {
    ...CEFR_COVERAGE_MATRIX,
    descriptorRows: CEFR_COVERAGE_MATRIX.descriptorRows.map((row, index) => {
      if (index !== 1) return row;
      return {
        ...row,
        descriptorId: `${row.descriptorId}:dup-stage-skill`,
        stage: CEFR_COVERAGE_MATRIX.descriptorRows[0].stage,
        skill: CEFR_COVERAGE_MATRIX.descriptorRows[0].skill,
      };
    }),
  };

  const report = buildCefrCoverageReport(broken);
  const codes = new Set(report.gaps.map((gap) => gap.code));
  assert.equal(codes.has("duplicate_stage_skill_mapping"), true);
  assert.equal(codes.has("missing_stage_skill_mapping"), true);
});
