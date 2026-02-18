# CH-15 Difficulty Matching Protocol

Last updated: 2026-02-18

## Goal

Make transfer fail labels valid only when there is a matched-difficulty in-domain control pass in the same window.

## Implemented protocol (v1)

1. Each completed OOD attempt gets a transfer verdict evaluated in worker runtime.
2. OOD pass (`taskScore >= 70`) is labeled `transfer_pass`.
3. OOD candidate fail (`taskScore < 70`) becomes `transfer_fail_validated` only if there is at least one completed in-domain control attempt that:
   - is within the last 72 hours,
   - has non-OOD task instance,
   - has matched difficulty (`|difficulty - inDomainDifficulty| <= 8`),
   - and passed (`taskScore >= 70`).
4. If no such control pass exists, verdict is not a fail label; it becomes `inconclusive_control_missing`.

## Runtime write path

- Module: `src/lib/ood/transferVerdict.ts`
- Worker integration: `src/worker/index.ts`
- Updated OODTaskSpec fields:
  1. `status = "evaluated"`
  2. `verdict` (`transfer_pass`, `transfer_fail_validated`, `inconclusive_control_missing`, `inconclusive_missing_ood_score`)
  3. `difficultyDelta` (anchor minus matched control difficulty when available)
  4. `metadataJson.transferVerdict` with protocol diagnostics and matched-control evidence details

## Audit artifact

Endpoint:

`GET /api/quality/transfer-verdict?windowDays=30&limit=5000`

Returns transfer verdict audit with:

1. candidate transfer fails
2. validated/unvalidated transfer fails
3. protocol violations (`transfer_fail_validated` without matched control pass)
4. verdict and axis breakdown

Script:

`npx tsx src/scripts/ch15_transfer_verdict_audit.ts --window-days 30 --output docs/reports/CH15_TRANSFER_VERDICT_AUDIT_REPORT.json`

The script exits non-zero when protocol violations exceed configured threshold.
