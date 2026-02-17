# CH-08 Causal Inference Pipeline

Status: `implemented`
Version: `causal-inference-v1`

## Scope

CH-08 adds causal model inference to the runtime pipeline:

1. Every valid completed attempt gets `CausalDiagnosis` with:
   - full cause distribution,
   - `topLabel`, `topProbability`, `entropy`, `topMargin`,
   - confidence interval,
   - counterfactual remediation hint.
2. Attempt details API includes a causal payload.
3. Calibration report script summarizes model behavior over recent windows.

## Runtime write-path

Worker integration:

- `src/worker/index.ts` now calls `inferCausalDiagnosis(...)` after evaluation.
- Result is persisted with `prisma.causalDiagnosis.upsert(...)` linked by `attemptId`.

Inference module:

- `src/lib/causal/inference.ts`
- Uses deterministic evidence signals from transcript, speech metrics, rubric/grammar/LO/vocab checks.
- Produces normalized distribution over causal taxonomy labels.

## API output

Attempt details endpoint:

- `GET /api/attempts/[id]`
- Response `results.causal` includes:
  - `taxonomyVersion`, `modelVersion`
  - `topLabel`, `topProbability`, `entropy`, `topMargin`
  - `distribution`
  - `confidenceInterval`
  - `counterfactual`
  - `createdAt`

## Calibration report

Run:

```bash
npm run causal:calibration -- --days 30 --output docs/reports/CH08_CAUSAL_CALIBRATION_REPORT.json
```

Output includes:

1. sample size and window bounds,
2. top-label counts/rates,
3. entropy and margin aggregates,
4. confidence interval width diagnostics,
5. recent sample rows for manual audit.
