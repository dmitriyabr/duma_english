# CH-18 Transfer Remediation Queue

Last updated: 2026-02-18

## Goal

Route learners to targeted remediation after OOD transfer failure signals and track recovery through repeat transfer verification.

## Implemented components

1. Runtime queue module: `src/lib/ood/transferRemediationQueue.ts`
2. Worker write-path integration: `src/worker/index.ts`
3. Queue dashboard contract + aggregator:
   - `src/lib/contracts/transferRemediationQueueDashboard.ts`
   - `src/lib/quality/transferRemediationQueueDashboard.ts`
4. Quality API endpoint: `src/app/api/quality/transfer-remediation-queue/route.ts`
5. Report script: `src/scripts/ch18_transfer_remediation_queue_report.ts`
6. Tests:
   - `src/lib/ood/transferRemediationQueue.test.ts`
   - `src/lib/contracts/transferRemediationQueueDashboard.test.ts`
   - `src/lib/quality/transferRemediationQueueDashboard.test.ts`

## Queue protocol (v1)

Queue type:

`transfer_remediation`

Enqueue triggers:

1. `transfer_fail_validated`
2. `inconclusive_control_missing`

Resolution trigger:

1. `transfer_pass` on a subsequent OOD attempt closes the oldest open transfer-remediation item.

Default remediation SLA:

1. Due in 72 hours (`TRANSFER_REMEDIATION_DUE_HOURS`).
2. Recovery tracking window annotated in metadata: 14 days.

## Dashboard artifact

Endpoint:

`GET /api/quality/transfer-remediation-queue?windowDays=30&limit=5000`

Main metrics:

1. queue volume and status breakdown (`pending/scheduled/completed`)
2. SLA metrics (`overdueCount`, `completedOnTimeCount`, `slaOnTimeCompletionRate`, `slaBreachCount`)
3. Recovery metrics (`recoveryResolvedCount`, `recoveryRate`, `medianResolutionLatencyHours`)

Script:

`npx tsx src/scripts/ch18_transfer_remediation_queue_report.ts --window-days 30 --output docs/reports/CH18_TRANSFER_REMEDIATION_QUEUE_DASHBOARD.json`
