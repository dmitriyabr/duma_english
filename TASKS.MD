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

## 3) What was just fixed
1. **Mastery improvements (streak + N-CCR + PFA):** In `applyEvidenceToStudentMastery`: (a) **Streak:** `directSuccessStreak` in `spacingStateJson`; 2nd+ direct success in a row gets weight ×1.15. (b) **N-CCR:** 2 direct successes in a row → set **verified** even if mean &lt; 70. (c) **PFA-style:** score ≥ 0.6 → weight ×1.1; score &lt; 0.4 → weight ×0.9. Plan: `docs/MASTERY_IMPROVEMENTS_PLAN.md`.
2. **Planner spread and fast credit:** (a) Planner: at most 2 of 3 target nodes from preferred set (verification + bundle), so other nodes get a slot; penalty for recently targeted nodes (0.28 per node in last 3 tasks) to rotate away from same descriptor; preferredBoost 0.4→0.18, verificationGain 1.15→0.55 per hit. (b) Fast credit for lower-level bundles: when placement is above a bundle stage, node counts as covered if value≥50 and ≥1 direct evidence (no need for verified+70), so path-to-next-level bar moves without grinding.
3. **Placement-driven promotion and bundle alignment:** If placement (evidence from all nodes) is above bundle-based promotion, we set promotion = placement so the UI shows the real level (e.g. B1) instead of A0. Planner now prefers target-stage bundle nodes (after verification queue) so exercises align with "path to next level". See DEBUG_PLAYBOOK § E3.
4. Profile inspection script: `npx tsx src/scripts/inspect_teacher_profile.ts [studentId]` explains (1) why 0 nodes are closed (verified & value≥70 per bundle), (2) why blocking nodes (GSE bundle descriptors) differ from words in tasks (vocab queue), (3) exact readiness score breakdown (e.g. 17% = 0+8+3+6). See DEBUG_PLAYBOOK § E2.
5. Skill progress (direct evidence): For target_vocab, "word used" is now checked against required words from the prompt that are bound to each target node by descriptor/alias. So when the prompt says "Use: school, learn" and the target node has descriptor or alias "school", the learner saying "school" counts as vocab_target_used (direct evidence). Previously we only matched node descriptor/sourceKey, so we almost always wrote vocab_target_missing. Script: `npx tsx src/scripts/inspect_recent_tasks.ts` to inspect evidence by kind (direct vs supporting vs negative).
6. Task generator prompt no longer sends raw GSE node IDs to the LLM:
   - Planner returns `targetNodeDescriptors` (human-readable objectives); task/next passes them as `targetNodeLabels` to the generator.
   - Prompt uses "Target learning objectives" with descriptors and instructs the model to copy given IDs into `target_nodes`.
   - Grammar nodes with missing descriptor show as "Grammar accuracy at this level" instead of "No grammar descriptor available."
7. Vocab matching bug fixed:
- no more matching by technical `sourceKey` IDs.
- matching now uses descriptor/alias lexical forms.
8. Alias coverage fixed:
- auto alias generation added.
- full alias backfill script executed locally.
9. Grammar capture strengthened:
- positive and negative incidental grammar signals are emitted.
- agreement-type errors are explicitly captured.
10. Validation status:
- `npm test` pass
- `npm run lint` pass
- `npm run build` pass

## 4) Critical Open Gaps (brain-level only)
1. **Planner vs promotion bundle alignment:** Exercises are chosen from “any nodes in stage band”; progress is counted only on **bundle** nodes (A1 Grammar/Vocab/Can-Do). So tasks often don’t target the same nodes that move the “path to next level” bar. Done: we lift promotion to placement when placement > bundle promotion and prefer target-stage bundle nodes in planner. Fast credit implemented: when placement is above a bundle stage, nodes with value≥50 and ≥1 direct count as covered.
2. Incidental vocab disambiguation is still too broad:
- one word can match many nodes.
- need top-k resolution by stage range + context.
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

## 6) Immediate Next Steps (in order)
1. Implement Sprint A (disambiguation top-k + tests).
2. Implement Sprint B (verification SLA + tests).
3. Re-run real user attempts and inspect last 10 attempt traces.
4. Only then tune promotion thresholds.

## 7) Guardrails
1. No return to legacy skill model.
2. No planner decision without `targetNodeIds`.
3. No stage promotion from incidental-only evidence.
4. No UI display of raw `gse:...` codes as primary text.

## 8) Teacher / Student UI (feature branch) — implemented
- Branch: `feature/teacher-student-ui`
- Plan: `docs/TEACHER_STUDENT_UI_PLAN.md`
- Done: Teacher auth (email + password, signup/login), dashboard, classes, add students, generate codes, student profile (updates, dynamics, GSE nodes). Student login unchanged (code + name). Landing links to `/teacher` instead of `/admin`.

## 9) Docs Index
Authoritative docs are in:
1. `docs/BRAIN_RUNTIME.md`
2. `docs/BRAIN_ROADMAP.md`
3. `docs/DEBUG_PLAYBOOK.md`
4. `docs/TEACHER_STUDENT_UI_PLAN.md` (teacher/student UI)
