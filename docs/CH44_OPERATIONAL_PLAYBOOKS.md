# CH-44 — Operational Playbooks Automation

**Status:** DONE  
**Artifact:** Runbook triggers + incident outcomes report.

## Goal

Automate detection of four operational patterns (runbooks) and produce an incident outcomes report:

1. **Retry loop** — learner gets many NEEDS_RETRY in a short window (e.g. 3+ of last 5 attempts).
2. **Cause plateau** — causal diagnosis stuck on same top cause (e.g. same label in 4 of last 5 diagnoses).
3. **Weak transfer despite high in-domain** — in-domain task pass rate high (≥70%) but OOD transfer pass rate low (≤40% over ≥3 evaluable OOD tasks).
4. **Fast progress low reliability** — placement stage is B1+ but target-stage reliability ratio below gate (0.65).

## Implementation

### Contract

- `src/lib/contracts/operationalPlaybooks.ts`: RunbookId, PlaybookTrigger, IncidentOutcome, OperationalPlaybooksReport (contractVersion, generatedAt, window, incidents, summary by runbook).

### Triggers

- `src/lib/playbooks/triggers.ts`: Pure evaluators:
  - `evaluateRetryLoopTrigger(attempts[], now)` — last 5 attempts, ≥3 NEEDS_RETRY.
  - `evaluateCausePlateauTrigger(causalRows[], now)` — last 5 CausalDiagnosis, same topLabel in ≥4.
  - `evaluateWeakTransferTrigger(aggregateRow, now)` — in-domain rate ≥0.7, OOD evaluable ≥3, OOD pass rate ≤0.4.
  - `evaluateFastProgressLowReliabilityTrigger(projectionRow, now)` — placementStage B1+, targetStageStats.reliabilityRatio < 0.65.

### Report

- `src/lib/quality/operationalPlaybooksReport.ts`: `buildOperationalPlaybooksReport({ windowDays, limit })` — fetches Attempts (status), CausalDiagnosis, OODTaskSpec, GseStageProjection; groups by student; runs triggers; returns report with incidents and summary counts.

### API and script

- **API:** GET `/api/quality/operational-playbooks?windowDays=14&limit=2000` (student auth).
- **Script:** `npm run operational-playbooks:report` → `docs/reports/CH44_OPERATIONAL_PLAYBOOKS_REPORT.json` (optional `--window-days`, `--limit`, `--output`).

## References

- Retry: Attempt.status NEEDS_RETRY, `src/lib/speechRetryGate.ts`, `src/lib/topicRetryGate.ts`.
- Cause: CausalDiagnosis.topLabel, `src/lib/causal/inference.ts`.
- Transfer: OODTaskSpec.verdict, in-domain from Attempt.scoresJson.overallScore.
- Reliability: GseStageProjection.evidenceJson.targetStageStats.reliabilityRatio, `src/lib/gse/bundles.ts` RELIABILITY_THRESHOLD.
