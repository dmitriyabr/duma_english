# CH-09 Cause-Attributed Evidence Write Path

## Scope

CH-09 extends the runtime evidence pipeline so causal diagnosis is persisted with each evidence row and mirrored into mastery state.

Done criteria for CH-09:
- `AttemptGseEvidence` stores top cause, probability, distribution, and model version.
- `StudentGseMastery` stores dominant cause, probability, distribution, and model version.
- Audit script reports coverage and contract integrity for the write-path.

## Data model changes

Added nullable fields:
- `AttemptGseEvidence.causeTopLabel`
- `AttemptGseEvidence.causeTopProbability`
- `AttemptGseEvidence.causeDistributionJson`
- `AttemptGseEvidence.causeModelVersion`
- `StudentGseMastery.dominantCauseLabel`
- `StudentGseMastery.dominantCauseProbability`
- `StudentGseMastery.dominantCauseDistributionJson`
- `StudentGseMastery.dominantCauseModelVersion`

Migration:
- `prisma/migrations/20260217233800_ch09_cause_attributed_evidence/migration.sql`

## Runtime write path

- `src/lib/gse/evidence.ts`
  - Reads `CausalDiagnosis` by `attemptId`.
  - Writes cause attribution into each new `AttemptGseEvidence` row.
  - Passes cause attribution into mastery update payload.
- `src/lib/gse/mastery.ts`
  - Persists dominant cause attribution in `StudentGseMastery` upsert payload.
  - Uses Prisma nullable JSON sentinels for safe optional JSON writes.

## Audit script

Script:
- `src/scripts/ch09_cause_attribution_audit.ts`

Command:
```bash
npm run cause:audit -- --days 30 --output docs/reports/CH09_CAUSE_ATTRIBUTION_AUDIT_REPORT.json
```

The report includes:
- attempt-level and row-level attribution coverage,
- missing field counts,
- probability/distribution contract violations,
- mismatch rates vs `CausalDiagnosis` top label/model version,
- mastery attribution coverage and integrity metrics.
