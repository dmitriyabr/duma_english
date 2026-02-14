# TASKS (Single Source Of Truth)

Last updated: 2026-02-14
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
9. Vocabulary incidental selection is now “lemma + index + LLM checks”:
- transcript is lemmatized (spaCy service if configured, otherwise fallback).
- a stage/audience-windowed in-memory index matches lemma/surface n-grams to `GSE_VOCAB` aliases/descriptors.
- evaluation LLM receives only the shortlisted vocab options and returns `vocabChecks`.
- `vocabChecks` are persisted as incidental vocab evidence (`targeted=false`) when `pass=true`.
- `GSE_VOCAB_CATALOGS` currently restricts *incidental* vocab indexing only (not planner-selected explicit targets).

## 3) What was just fixed
1. **Planner pool includes target-stage bundle nodes:** Previously the planner pool (loadNodeState) contained only nodes that already had a StudentGseMastery row in the current stage GSE range. Target-stage bundle nodes (e.g. B1) had no rows, so they were never in the pool and were never chosen — "preferred" had no effect. Now, after loading nodeStates, we add up to 45 target-stage bundle node IDs that are missing from the pool, with default state (decayedMastery 0, observed). So B1 bundle nodes get tasks, evidence accumulates, and node progress to B1 can grow. See DEBUG_PLAYBOOK § E4 and `npx tsx src/scripts/inspect_planner_flow.ts [studentId]`.
2. **Progress bar uses node progress:** The path-to-next-level bar no longer shows only “Mastery / All” (binary coverage). It now uses the **higher of** (1) bundle score (coverage at 70+, reliability, stability) and (2) **value progress** — for each required node, min(value, 70)/70, averaged over target-stage nodes. So the bar moves with every evidence (e.g. 45→50 on a node), not only when a node reaches 70. Teacher UI and student Progress page show “node progress X%”; teacher bar width = max(score, valueProgress×100).
3. **Mastery improvements (streak + N-CCR + PFA):** In `applyEvidenceToStudentMastery`: (a) **Streak:** `directSuccessStreak` in `spacingStateJson`; 2nd+ success in a row gets weight multiplier: ×1.25 (2nd), ×1.56 (3rd), ×1.8 (4th+ with cap). Streak applies to both direct and supporting success for weight bonus, but only direct success counts for N-CCR verification. (b) **N-CCR:** 2 direct successes in a row → set **verified** even if mean &lt; 70. (c) **PFA-style:** score ≥ 0.6 → weight ×1.1; score &lt; 0.4 → weight ×0.9. (d) **Supporting = direct по весу:** baseWeight(supporting, incidental)=1; сила только в conf/rel/impact, отдельный множитель не нужен. Plan: `docs/MASTERY_IMPROVEMENTS_PLAN.md`.
4. **Planner spread and fast credit:** (a) Planner: at most 2 of 3 target nodes from preferred set (verification + bundle), so other nodes get a slot; penalty for recently targeted nodes (0.28 per node in last 3 tasks) to rotate away from same descriptor; preferredBoost 0.4→0.18, verificationGain 1.15→0.55 per hit. (b) Fast credit for lower-level bundles: when placement is above a bundle stage, node counts as covered if value≥50 and ≥1 direct evidence (no need for verified+70), so path-to-next-level bar moves without grinding.
5. **Placement-driven promotion and bundle alignment:** If placement (evidence from all nodes) is above bundle-based promotion, we set promotion = placement so the UI shows the real level (e.g. B1) instead of A0. Planner now prefers target-stage bundle nodes (after verification queue) so exercises align with "path to next level". See DEBUG_PLAYBOOK § E3.
6. Profile inspection script: `npx tsx src/scripts/inspect_teacher_profile.ts [studentId]` explains (1) why 0 nodes are closed (verified & value≥70 per bundle), (2) why blocking nodes (GSE bundle descriptors) differ from words in tasks (vocab queue), (3) exact readiness score breakdown (e.g. 17% = 0+8+3+6). See DEBUG_PLAYBOOK § E2.
7. **target_vocab: prompt words = target nodes:** For target_vocab, the words in the prompt ("use: …") and requiredWords now come from the **planner’s target node descriptors** for that task, not from StudentVocabulary. So we only penalize for words we actually asked the learner to use. Fallback to vocab queue if &lt; 2 node descriptors. See DEBUG_PLAYBOOK § E2.
9. Skill progress (direct evidence): For target_vocab, "word used" is now checked against required words from the prompt that are bound to each target node by descriptor/alias. So when the prompt says "Use: school, learn" and the target node has descriptor or alias "school", the learner saying "school" counts as vocab_target_used (direct evidence). Previously we only matched node descriptor/sourceKey, so we almost always wrote vocab_target_missing. Script: `npx tsx src/scripts/inspect_recent_tasks.ts` to inspect evidence by kind (direct vs supporting vs negative).
10. Task generator prompt no longer sends raw GSE node IDs to the LLM:
   - Planner returns `targetNodeDescriptors` (human-readable objectives); task/next passes them as `targetNodeLabels` to the generator.
   - Prompt uses "Target learning objectives" with descriptors and instructs the model to copy given IDs into `target_nodes`.
   - Grammar nodes with missing descriptor show as "Grammar accuracy at this level" instead of "No grammar descriptor available."
11. Vocab matching bug fixed:
- no more matching by technical `sourceKey` IDs.
- matching now uses descriptor/alias lexical forms.
12. Alias coverage fixed:
- auto alias generation added.
- full alias backfill script executed locally.
13. Grammar capture strengthened:
- positive and negative incidental grammar signals are emitted.
- agreement-type errors are explicitly captured.
14. Validation status:
- `npm test` pass
- `npm run lint` pass
- `npm run build` pass
15. Worker pipeline race hardening:
- claim of next uploaded attempt is now conditional (`updateMany` guard), preventing double-claim by concurrent workers.
- attempt finalization writes are guarded by status transitions, and per-attempt metrics are rewritten idempotently.
16. Placement modularization:
- API and worker now use dedicated entry points:
  - IRT: `src/lib/placement/irt.ts`
  - Extended: `src/lib/placement/extended.ts`
  - Shared state-machine helpers: `src/lib/placement/shared.ts`
- Existing `src/lib/placement.ts` remains compatible as legacy facade.
17. Teacher API scalability:
- class/student heavy endpoints now support additive `limit/offset` and bounded list limits.
- class roster stage loading no longer calls full progress computation per student.
6. Semantic LO/Grammar hardening (current iteration):
- parser prompt upgraded for exhaustive, atomic extraction (recall-first).
- embedding queries made topic-robust for grammar (query = pattern label only).
- retrieval list is reordered by query coverage so top-8 options cover all extracted patterns.
- evaluator now includes explicit task targets (not only incidental retrieval).
7. Vocab disambiguation first pass:
- stage-windowed vocab index + lemma/surface n-gram matching produces a small candidate list.
- evaluator receives vocab options and emits `vocabChecks` (LLM context validation).
- legacy alias-scan incidental discovery remains only as fallback when no `vocabChecks` exist.
8. Evaluation prompt hygiene:
- target options are capped to fit the evaluator limits (LO<=4, Grammar<=6, Vocab<=8).
- prompt sections are normalized as `Target ... options` and `Candidate ... options` to avoid ambiguity.
15. **Planner pool (spaced repetition):** (a) Fully mastered nodes (verified and decayedMastery ≥ 70) are excluded from the pool so they don’t take slots; when they decay (value &lt; 70 or overdue), the same row re-enters on the next load. (b) Lower-level refresh: any not-fully-mastered nodes from the **previous stage bundle** (with or without evidence; default state if no row) are candidates; we add a **random sample** of them to the pool, **fewer than** current-level pool size (cap 20), so prev-stage stays a minority.

## 4) Critical Open Gaps (brain-level only)
1. **Planner vs promotion bundle alignment:** Exercises are chosen from “any nodes in stage band”; progress is counted only on **bundle** nodes (A1 Grammar/Vocab/Can-Do). So tasks often don’t target the same nodes that move the “path to next level” bar. Done: we lift promotion to placement when placement > bundle promotion and prefer target-stage bundle nodes in planner. Fast credit implemented: when placement is above a bundle stage, nodes with value≥50 and ≥1 direct count as covered.
2. Incidental vocab disambiguation still needs calibration:
- candidate generation is lexical-first and stage-windowed, but still needs better ambiguity handling.
- need stricter caps per lexical unit (avoid many nodes per same word), and better sense checks for polysemy.
- need precision QA to avoid false positives on high-frequency words.
3. Semantic LO/Grammar evaluation needs calibration and precision QA:
- tune parser/evaluator prompts and thresholds from real traces.
- add gold-set precision checks for false-positive suppression.
4. Verification queue policy needs hard enforcement:
- candidates must be verified within next N tasks.
- no silent starvation.
5. Promotion still needs stricter verified-only math by domain:
- make domain quotas explicit (`vocab`, `grammar`, `lo`).
6. Cold-start diagnostics still over-focuses on narrow node clusters:
- need stronger domain balancing in first 8-12 tasks.

## 5) Active Execution Plan (no legacy work)

### Sprint A: Vocab Disambiguation Hardening
1. Done: stage-windowed candidate ranking (lemma + n-gram match against in-memory alias/descriptor index).
2. Next: per-lexeme caps (top-k per lemma/ngram) and diversity (prefer distinct n-grams).
3. Next: ambiguity penalty + polysemy prompts (e.g., `bank` river vs money).
4. Next: tests for false-positive suppression and phrase matching.

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
2. Start lemma service locally (`docker compose --profile nlp up -d lemma_service`) and set `LEMMA_SERVICE_URL`.
3. Execute 50 real-attempt traces and review semantic incidental precision (LO/grammar + vocabChecks).
4. Implement Sprint E calibration using trace outcomes.
5. Continue Sprint A (vocab caps/ambiguity) and Sprint B (verification SLA).

## 7) Guardrails
1. No return to legacy skill model.
2. No planner decision without `targetNodeIds`.
3. No stage promotion from incidental-only evidence.
4. No UI display of raw `gse:...` codes as primary text.

## 8) Teacher / Student UI (feature branch) — implemented
- Branch: `feature/teacher-student-ui`
- Plan: `docs/TEACHER_STUDENT_UI_PLAN.md`
- Done: Teacher auth (email + password, signup/login), dashboard, classes, add students, generate codes, student profile (updates, dynamics, GSE nodes). Student login unchanged (code + name). Landing links to `/teacher` instead of `/admin`.

## 9) Eval split (LO / Grammar / Vocab) — реализовано
- Branch: `feature/eval-split-lo-grammar-vocab`
- Plan: `docs/EVAL_SPLIT_PLAN.md`
- Всегда: три LLM-запроса (LO, grammar, vocab) параллельно, затем один общий (taskScore, rubricChecks, artifacts, evidence, feedback). Лимиты: LO 16/8, Grammar 14/10, Vocab 20/12. Сборка в один taskEvaluation, контракт evidence/mastery без изменений.

## 10) Docs Index
Authoritative docs are in:
1. `docs/BRAIN_RUNTIME.md`
2. `docs/BRAIN_ROADMAP.md`
3. `docs/DEBUG_PLAYBOOK.md`
4. `docs/TEACHER_STUDENT_UI_PLAN.md` (teacher/student UI)
5. `docs/EVAL_SPLIT_PLAN.md` (split evaluation by domain)
6. `docs/LAST_ATTEMPT_TRACE.md` (разбор последней попытки по шагам: транскрипт → парсер → retrieval → evaluator → evidence)
