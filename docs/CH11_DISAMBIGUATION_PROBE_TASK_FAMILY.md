# CH-11 Disambiguation Probe Task Family

Last updated: 2026-02-18

## Goal

Add dedicated disambiguation micro-probes that separate competing causal hypotheses, with runtime budget caps to avoid over-probing.

## Implemented components

1. Probe planning module: `src/lib/causal/disambiguationProbe.ts`
2. Task generator integration for probe task-type override and probe prompt guidance:
   - `src/lib/taskGenerator.ts`
   - `src/lib/taskGenerator.test.ts`
3. Budget telemetry artifact script: `src/scripts/ch11_disambiguation_probe_budget_report.ts`
4. Unit tests: `src/lib/causal/disambiguationProbe.test.ts`

## Probe selection policy (v1)

1. Input: ambiguity trigger flag + top competing causal labels.
2. Output: `DisambiguationProbePlan` with:
   - selected micro-task family (`selectedTaskType`)
   - probe skill key
   - probe template key
   - explicit `reasonCode` (`ready`, `not_triggered`, budget-exhausted states)
3. Cause-pair to probe mapping:
   - retrieval-heavy ambiguity -> `target_vocab` cue probe
   - rule vs instruction ambiguity -> `qa_prompt` split-step probe
   - L1 interference ambiguity -> `role_play` contrastive probe
   - production/attention ambiguity -> `read_aloud` constrained fluency probe
   - fallback -> generic `qa_prompt` diagnostic probe

## Budget guards

Session window defaults:

1. `sessionWindowMinutes = 90`
2. `maxPerSession = 2`
3. `maxPerSkillPerSession = 1`
4. `maxPerCausePairPerSession = 1`

Plan is disabled when any cap is exhausted, and the reason is emitted in `reasonCode`.

## Telemetry artifact

Command:

`npm run disambiguation:budget -- --days 30 --output docs/reports/CH11_DISAMBIGUATION_PROBE_BUDGET_REPORT.json`

Current artifact includes:

1. probe enablement rate
2. budget-violation rates (session, skill, cause-pair)
3. reason-code distribution

