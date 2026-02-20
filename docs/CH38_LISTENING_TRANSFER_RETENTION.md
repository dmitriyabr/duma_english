# CH-38 - Listening runtime + assessment pipeline (quality stack)

## Objective
Add quality observability for listening tasks: transfer verdict (OOD pass/fail) and retention (7d/30d) metrics, with a versioned contract, API, and report artifact.

## What Landed

### 1) Listening transfer/retention report contract
- Contract and schema:
  - `src/lib/contracts/listeningTransferRetentionReport.ts`
  - Version: `listening-transfer-retention-report-v1`
- Contract test:
  - `src/lib/contracts/listeningTransferRetentionReport.test.ts`

### 2) Quality aggregator
- Report builder:
  - `src/lib/quality/listeningTransferRetentionReport.ts`
  - `buildListeningTransferRetentionReport({ windowDays?, limit?, now? })`
- Loads completed attempts in window, filters listening via `isListeningTaskType`, loads OODTaskSpec for listening tasks, builds transfer (pass/fail) and retention (7d/30d) via `buildRetentionProbes` from `src/lib/retention/probes.ts`.
- Output: by-stage breakdown, transfer pass rate, retention pass rates.

### 3) API and script
- Quality API:
  - `GET /api/quality/listening-transfer-retention?windowDays=&limit=`
  - `src/app/api/quality/listening-transfer-retention/route.ts`
- Report script:
  - `src/scripts/ch38_listening_transfer_retention_report.ts`
  - npm alias: `npm run listening:transfer-retention:report`
  - Default output: `docs/reports/CH38_LISTENING_TRANSFER_RETENTION_REPORT.json`

## Artifact
- `docs/reports/CH38_LISTENING_TRANSFER_RETENTION_REPORT.json`

## Validation
- `npm test -- src/lib/contracts/listeningTransferRetentionReport.test.ts`
- `npm run listening:transfer-retention:report -- --window-days 30 --output docs/reports/CH38_LISTENING_TRANSFER_RETENTION_REPORT.json`
- `npm run lint`
- `npm run build`
