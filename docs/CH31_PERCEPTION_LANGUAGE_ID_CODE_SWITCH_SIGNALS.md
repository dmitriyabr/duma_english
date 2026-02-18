# CH31 - Perception language-id + code-switch signals

## Scope
- Add deterministic perception-layer language tagging for attempt transcripts.
- Surface language-id/code-switch signals in attempt payloads.
- Publish telemetry endpoint and report artifact for tagged attempts and calibration sampling.

## Runtime changes
- New module: `src/lib/perception/languageSignals.ts`
  - Versioned output contract: `perception-language-signals-v1`.
  - Tags: `english`, `swahili`, `sheng`, `home_language_hint`.
  - Code-switch signal includes `detected`, `tagSet`, `transitions`, `confidence`, `dominantPair`.
  - Home-language hints include detected language labels and token samples.
- Evaluator integration: `src/lib/evaluator.ts`
  - Every evaluated attempt now writes `taskEvaluation.artifacts.languageSignals`.
  - Works for both OpenAI split path and deterministic fallback path.
- Attempt API integration: `src/app/api/attempts/[id]/route.ts`
  - `results.language.perception` now returns the normalized language signal payload.

## Telemetry and reporting
- Contract: `src/lib/contracts/languageSignalTelemetry.ts`
- Aggregation: `src/lib/quality/languageSignalTelemetry.ts`
- API: `GET /api/quality/language-signals`
  - Query params: `windowDays`, `attemptLimit`, `sampleLimit`
- Report script: `npm run language-signals:report`
  - Output default: `docs/reports/CH31_LANGUAGE_SIGNAL_REPORT.json`
  - Includes calibration samples for code-switch/low-confidence/home-language-hint rows.

## Validation
- Tests:
  - `src/lib/perception/languageSignals.test.ts`
  - `src/lib/evaluator.test.ts` (artifact integration assertion)
  - `src/lib/contracts/languageSignalTelemetry.test.ts`
  - `src/lib/quality/languageSignalTelemetry.test.ts`
- Runtime checks:
  - `npm test -- src/lib/perception/languageSignals.test.ts src/lib/evaluator.test.ts src/lib/contracts/languageSignalTelemetry.test.ts src/lib/quality/languageSignalTelemetry.test.ts`
  - `npx tsx src/scripts/ch31_language_signal_report.ts --window-days 30 --output docs/reports/CH31_LANGUAGE_SIGNAL_REPORT.json`
  - `npm run lint`
  - `npm run build`
