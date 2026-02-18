# CH-32 — L1 Interference Priors and Templates

## Objective
Make policy decisions localization-aware by applying L1 interference priors by age band and domain, and attaching targeted remediation templates when interference evidence is present.

## What Landed

### 1) Localization priors and template catalog runtime
- Added `src/lib/localization/interferencePrior.ts` (`l1-interference-prior-v1`).
- Added age-band/domain prior matrix for `6-8`, `9-11`, `12-14` and fallback behavior.
- Added language-signal modulation (`primaryTag`, `tagSet`, `codeSwitchDetected`, `homeLanguageHints`).
- Added targeted remediation template catalog per age/domain.

### 2) Causal remediation policy integration
- Updated `src/lib/causal/remediationPolicy.ts`:
  - consumes age/domain/language-signal context,
  - applies L1 prior boost to action-family scoring when L1 evidence exists in causal posterior,
  - assigns remediation templates for actionable task families,
  - emits trace fields for interference prior and template recommendations.
- Expanded policy adjustment payload with:
  - `domain`,
  - `interferencePriorBoost`,
  - `templateKey/templateTitle/templatePrompt`.

### 3) Planner trace and decision explainability
- Updated `src/lib/gse/planner.ts`:
  - derives domain-by-task mapping from candidate targets,
  - extracts recent language signals from attempt evaluation artifacts,
  - passes localization context to causal remediation policy,
  - persists chosen template/domain/prior boost in `causalRemediation` decision trace.
- Selection reason now includes targeted template context when applied.

### 4) Cause-to-template mapping telemetry/reporting
- Added contract `src/lib/contracts/l1InterferenceTemplateReport.ts`.
- Added quality summary `src/lib/quality/l1InterferenceTemplateReport.ts`.
- Added API endpoint:
  - `GET /api/quality/l1-interference-templates`
- Added script:
  - `src/scripts/ch32_l1_interference_template_report.ts`

## Artifact
- `docs/reports/CH32_L1_INTERFERENCE_TEMPLATE_REPORT.json`

## Validation
- Unit tests:
  - `src/lib/localization/interferencePrior.test.ts`
  - `src/lib/causal/remediationPolicy.test.ts`
  - `src/lib/contracts/l1InterferenceTemplateReport.test.ts`
  - `src/lib/quality/l1InterferenceTemplateReport.test.ts`
- Report command:
  - `npx tsx src/scripts/ch32_l1_interference_template_report.ts --window-days 30 --output docs/reports/CH32_L1_INTERFERENCE_TEMPLATE_REPORT.json`
