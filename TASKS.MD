# TASKS (Single Source Of Truth)

Last updated: 2026-02-07
Owner: product brain track (GSE-only)

## 1) Product Goal
Build an autonomous speaking trainer where every learning decision is based on GSE node evidence, not legacy skill averages.

## 2) Runtime Truth (what is true in code now)
1. Brain is GSE-first:
- next task uses GSE planner.
- stage/progress use GSE projection.
2. Evidence pipeline exists:
- `VOCAB`, `GRAMMAR`, `LO` evidence is persisted per attempt.
- mastery uses `alpha/beta`, uncertainty, decay fields.
3. Dual stage exists:
- `placementStage` (provisional)
- `promotionStage` (bundle-gated)
4. Node lifecycle exists:
- `observed -> candidate_for_verification -> verified`
5. Read-aloud does not directly promote lexical meaning.
6. API explainability exists:
- attempts/progress/task-next return GSE-specific reasons and node targets.
7. Semantic incidental detection for LO/Grammar exists:
- parser LLM extracts communicative intents + grammar patterns from transcript.
- retrieval stage ranks `GSE_LO` and `GSE_GRAMMAR` candidates by embeddings within stage/audience filters.
- evaluation LLM receives only the shortlisted options and produces structured LO/grammar checks used by the evidence pipeline.
- embeddings are persisted in `GseNodeEmbedding` and can be backfilled via script.
8. Explicit task targets are passed into evaluation:
- worker loads `TaskGseTarget` rows for the task and supplies them to the evaluator.
- evaluation is expected to include checks for these targets; target grammar checks use `opportunityType=explicit_target`.

## 3) What was just fixed
1. Task generator prompt no longer sends raw GSE node IDs to the LLM:
   - Planner returns `targetNodeDescriptors` (human-readable objectives); task/next passes them as `targetNodeLabels` to the generator.
   - Prompt uses "Target learning objectives" with descriptors and instructs the model to copy given IDs into `target_nodes`.
   - Grammar nodes with missing descriptor show as "Grammar accuracy at this level" instead of "No grammar descriptor available."
2. Vocab matching bug fixed:
- no more matching by technical `sourceKey` IDs.
- matching now uses descriptor/alias lexical forms.
3. Alias coverage fixed:
- auto alias generation added.
- full alias backfill script executed locally.
4. Grammar capture strengthened:
- positive and negative incidental grammar signals are emitted.
- agreement-type errors are explicitly captured.
5. Validation status:
- `npm test` pass
- `npm run lint` pass
- `npm run build` pass
6. Semantic LO/Grammar hardening (current iteration):
- parser prompt upgraded for exhaustive, atomic extraction (recall-first).
- embedding queries made topic-robust for grammar (query = pattern label only).
- retrieval list is reordered by query coverage so top-8 options cover all extracted patterns.
- evaluator now includes explicit task targets (not only incidental retrieval).

## 4) Critical Open Gaps (brain-level only)
1. Incidental vocab disambiguation is still too broad:
- one word can match many nodes.
- need top-k resolution by stage range + context.
2. Semantic LO/Grammar evaluation needs calibration and precision QA:
- tune parser/evaluator prompts and thresholds from real traces.
- add gold-set precision checks for false-positive suppression.
3. Verification queue policy needs hard enforcement:
- candidates must be verified within next N tasks.
- no silent starvation.
4. Promotion still needs stricter verified-only math by domain:
- make domain quotas explicit (`vocab`, `grammar`, `lo`).
5. Cold-start diagnostics still over-focuses on narrow node clusters:
- need stronger domain balancing in first 8-12 tasks.

## 5) Active Execution Plan (no legacy work)

### Sprint A: Vocab Disambiguation Hardening
1. Add candidate ranking for incidental vocab matches.
2. Keep only top-k node matches per lexical unit.
3. Add confidence penalty for ambiguous matches.
4. Add tests for false-positive suppression.

### Sprint B: Verification-First Policy
1. Add hard SLA: candidate node must get verification task in <=2 tasks.
2. Add planner utility boost for verification backlog.
3. Add queue aging and priority escalation.
4. Add tests for candidate->verified conversion path.

### Sprint C: Promotion Gate Hardening
1. Add explicit per-domain verified coverage thresholds.
2. Require minimum direct evidence counts by domain.
3. Expose blockers in progress API with human labels only.
4. Add integration tests for blocked-vs-promoted transitions.

### Sprint D: Cold-Start Rebalance
1. Force exploration rotation across `vocab/grammar/lo`.
2. Prevent repeated narrow targets in first diagnostic window.
3. Add tests: no repeated same domain lock-in for new learner.

### Sprint E: Semantic LO/Grammar Quality Hardening
1. Build gold-set benchmark for LO/Grammar incidental detection.
2. Tune confidence/retrieval thresholds and max-candidate caps.
3. Add failure taxonomy (`parser_miss`, `retrieval_miss`, `evaluation_miss`) in debug metadata.
4. Add regression tests for known confusion pairs.

## 6) Immediate Next Steps (in order)
1. Run `gse:embeddings:backfill -- --all` in production-like data.
2. Execute 50 real-attempt traces and review semantic incidental precision.
3. Implement Sprint E calibration using trace outcomes.
4. Continue Sprint A (vocab top-k) and Sprint B (verification SLA).

## 7) Guardrails
1. No return to legacy skill model.
2. No planner decision without `targetNodeIds`.
3. No stage promotion from incidental-only evidence.
4. No UI display of raw `gse:...` codes as primary text.

## 8) Docs Index
Authoritative docs are in:
1. `docs/BRAIN_RUNTIME.md`
2. `docs/BRAIN_ROADMAP.md`
3. `docs/DEBUG_PLAYBOOK.md`
