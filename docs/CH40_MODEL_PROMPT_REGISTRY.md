# CH-40 - Model/prompt registry

## Objective
Centralise all judge/generator/causal/policy model and prompt versions in one registry, expose them via an endpoint for tracing and auditing, and support immutable release tags for reproducibility.

## What Landed

### 1) Version exports from modules
- Evaluator: `EVALUATOR_MODEL_VERSION` exported from `src/lib/evaluator.ts` (`eval-v2`).
- Causal inference: `CAUSAL_INFERENCE_MODEL_VERSION` from `src/lib/causal/inference.ts` (`causal-inference-v1`).
- Policy: `POLICY_VERSION` from `src/lib/policy/hybridSelector.ts` (`policy-hybrid-guardrailed-v1`).
- Existing exports used: `CAUSAL_TAXONOMY_V1_VERSION` (db/types), `CAUSAL_REMEDIATION_POLICY_VERSION` (remediationPolicy), `REWARD_FUNCTION_VERSION_V1` (reward/function), `SHADOW_POLICY_MODEL_VERSION` (shadowPolicyDashboard).
- Task generator: placeholder `task-generator-prompt-v1` in registry (no separate module yet).

### 2) Registry module
- Contract: `src/lib/contracts/modelPromptRegistry.ts` (version `model-prompt-registry-v1`).
- Registry builder: `src/lib/registry/modelPromptRegistry.ts`
  - `getModelPromptRegistry({ now?, releaseTag? })` — builds snapshot from versioned modules.
  - `getReleaseTag()` — returns `process.env.REGISTRY_RELEASE_TAG` if set, else date-based `release-YYYY-MM-DD`.
- Contract test: `src/lib/contracts/modelPromptRegistry.test.ts`.

### 3) API and script
- Quality API: `GET /api/quality/model-prompt-registry` — returns current registry JSON (auth required).
  - `src/app/api/quality/model-prompt-registry/route.ts`
- Report script: `src/scripts/ch40_model_prompt_registry_report.ts`
  - npm alias: `npm run model-prompt-registry:report`
  - Default output: `docs/reports/CH40_MODEL_PROMPT_REGISTRY.json`

### 4) Immutable release tags
- Set `REGISTRY_RELEASE_TAG` in env to pin a release (e.g. `release-2026-02-20`) for reproducibility.
- Registry response and report artifact include `releaseTag`.

## Artifact
- `docs/reports/CH40_MODEL_PROMPT_REGISTRY.json`

## Validation
- `npm test -- src/lib/contracts/modelPromptRegistry.test.ts`
- `npm run model-prompt-registry:report -- --output docs/reports/CH40_MODEL_PROMPT_REGISTRY.json`
- `npm run lint`
- `npm run build`
