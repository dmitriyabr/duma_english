# CEFR Coverage Matrix Contract

Version: `cefr-coverage.v1.2026-02-17`

## Purpose

Provide a versioned, machine-validated mapping:

`descriptor -> node selectors -> task family -> rubric row`

This is the execution artifact for `CH-01` from the autonomous autopilot board.

## Source of truth

- Contract and matrix: `src/lib/contracts/cefrCoverageMatrix.ts`
- Tests (release blocker): `src/lib/contracts/cefrCoverageMatrix.test.ts`
- Report generator: `src/scripts/cefr_coverage_report.ts`

## Release gate

`npm test` includes `cefrCoverageMatrix.test.ts`.

If any coverage gap appears, tests fail and release is blocked.

## Manual report

```bash
npx tsx src/scripts/cefr_coverage_report.ts
```

The script prints a JSON report with:

- matrix version
- stage-level coverage summary
- gap list
- `releaseBlocker=true/false`

By default, script exits with code `1` when gaps exist.
Use `--no-strict` to print report without failing:

```bash
npx tsx src/scripts/cefr_coverage_report.ts --no-strict
```
