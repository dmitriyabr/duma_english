# CH-30 — Retention-Aware Promotion Blockers

## Objective
Block high-stakes promotions when retention evidence fails gate conditions, even if immediate mastery/bundle signals are strong.

## What Landed

### 1) Retention promotion gate runtime
- Added `src/lib/retention/promotionGate.ts` (`retention-promotion-gate-v1`).
- Added high-stakes retention gate evaluation over 7/30/90 windows using direct evidence retention pass metrics.
- Gate behavior:
  - high-stakes targets (`B1+`) require retention gate pass,
  - gate can block promotion via explicit blocker reasons (`retention_*`).

### 2) Promotion pipeline integration
- Updated `src/lib/gse/stageProjection.ts`:
  - computes `retentionGate` alongside existing bundle/stress gates,
  - sets `promotionReady=false` when required retention gate fails,
  - adds `retention_gate_not_passed` blocker bundle into promotion blockers.
- Updated promotion-readiness explanation mapping in `src/lib/progress.ts`.
- Updated promotion audit reasons payloads in:
  - `src/lib/adaptive.ts`,
  - `src/lib/placement.ts`,
  so `PromotionAudit.reasonsJson` now includes retention gate context.

### 3) Audit telemetry/reporting
- Added contract `src/lib/contracts/retentionPromotionBlockerReport.ts`.
- Added quality summary `src/lib/quality/retentionPromotionBlockerReport.ts`.
- Added API endpoint:
  - `GET /api/quality/retention-promotion-blockers`
- Added script:
  - `src/scripts/ch30_retention_promotion_blocker_report.ts`

## Artifact
- `docs/reports/CH30_RETENTION_PROMOTION_BLOCKER_REPORT.json`

## Validation
- Unit tests:
  - `src/lib/retention/promotionGate.test.ts`
  - `src/lib/contracts/retentionPromotionBlockerReport.test.ts`
  - `src/lib/quality/retentionPromotionBlockerReport.test.ts`
- Report command:
  - `npx tsx src/scripts/ch30_retention_promotion_blocker_report.ts --window-days 30 --output docs/reports/CH30_RETENTION_PROMOTION_BLOCKER_REPORT.json`
