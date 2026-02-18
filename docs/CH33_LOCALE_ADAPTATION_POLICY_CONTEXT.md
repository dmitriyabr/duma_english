# CH-33 - Locale adaptation in policy context

## Objective
Propagate locale/L1 signals into runtime policy context so task selection becomes explainable for localized cohorts without breaking self-repair, disambiguation, or explicit task-type requests.

## What Landed

### 1) Locale policy context runtime
- Added `src/lib/localization/localePolicyContext.ts` (`locale-policy-context-v1`).
- Extracts language-signal samples from attempt evaluation artifacts.
- Summarizes profile context:
  - dominant primary tag (`english`/`swahili`/`sheng`/`home_language_hint`/`unknown`),
  - tag shares,
  - code-switch rate,
  - home-language hint set,
  - localized cohort flag.
- Produces explainable adaptation decision with versioned `reasonCodes` and optional `overrideTaskType`.

### 2) Task-next integration + decision trace linkage
- Updated `src/app/api/task/next/route.ts`.
- Runtime now:
  - reads recent completed attempts and extracts locale signals,
  - builds locale policy context before final task-type selection,
  - applies locale override only when safe (no immediate/delayed self-repair, no active disambiguation probe, no explicit `requestedType`),
  - appends locale explanation to effective selection reason.
- Task metadata now stores `localePolicyContext` (profile + adaptation + override trace).
- Creates `LearnerTwinSnapshot` (`source=locale_policy_context`) with `localeProfileJson` and supporting friction/motivation context.
- Links planner decision to the created twin snapshot and updates `PlannerDecisionLog` with:
  - `contextSnapshotId`,
  - effective `chosenTaskType`,
  - effective `selectionReason`,
  - locale profile/adaptation payload in `utilityJson`.

### 3) Quality contract/API/report for localized cohort uplift
- Added contract `src/lib/contracts/localePolicyContextReport.ts`.
- Added aggregator `src/lib/quality/localePolicyContextReport.ts`.
- Added API: `GET /api/quality/locale-policy-context`.
- Added report script: `src/scripts/ch33_locale_policy_context_report.ts`.
  - npm alias: `npm run locale-policy:report`
  - Default artifact: `docs/reports/CH33_LOCALE_POLICY_CONTEXT_REPORT.json`
- Report includes localized decision share, dominant tag/reason-code distributions, localized vs baseline task-score uplift, and localized decision samples.

## Artifact
- `docs/reports/CH33_LOCALE_POLICY_CONTEXT_REPORT.json`

## Validation
- `npm test -- src/lib/localization/localePolicyContext.test.ts src/lib/contracts/localePolicyContextReport.test.ts src/lib/quality/localePolicyContextReport.test.ts`
- `npm run locale-policy:report -- --window-days 30 --output docs/reports/CH33_LOCALE_POLICY_CONTEXT_REPORT.json`
- `npm run lint`
- `npm run build`
