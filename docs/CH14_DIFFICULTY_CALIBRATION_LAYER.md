# CH-14 Difficulty Anchor Calibration Layer

Last updated: 2026-02-18

## Goal

Introduce shared calibrated difficulty across task families for OOD transfer decisions.

## What was added

1. Calibration core: `src/lib/ood/difficultyCalibration.ts`
2. OOD generator integration: `src/lib/ood/generator.ts`
3. Stability report job: `src/scripts/ch14_difficulty_anchor_stability_report.ts`
4. Unit tests:
   - `src/lib/ood/difficultyCalibration.test.ts`
   - `src/lib/ood/generator.test.ts`

## Calibration model (v1)

1. Each task family has a profile (`mean`, `std`).
2. Raw family-local difficulty is converted to z-score within family.
3. Z-score is projected onto shared scale (`mean=50`, `std=15`, clamped `0..100`).
4. OODTaskSpec now stores calibrated anchor in `difficultyAnchor`/`inDomainDifficulty`.

## Periodic job artifact

Command:

`npm run difficulty:calibration -- --days=30 --output=docs/reports/CH14_DIFFICULTY_ANCHOR_STABILITY_REPORT.json`

Output includes:

1. Per-family profiles and drift from baseline.
2. Shared-scale stats (mean/std/min/max).
3. Stability bucket per family (`stable`, `watch`, `unstable`).

This report is the CH-14 operational artifact for ongoing calibration monitoring.
