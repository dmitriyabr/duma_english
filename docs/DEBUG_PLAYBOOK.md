# DEBUG PLAYBOOK (Brain)

Last updated: 2026-02-07

## A) When does incidental become “candidate for verification”?
Incidental evidence (supporting + opportunity=incidental + targeted=false) is counted per node in `spacingStateJson`: `incidentalTaskTypes` and `incidentalConfidences`. The node becomes **candidate_for_verification** when **all** of:
- **≥ 3** incidental observations (nextIncidentalConfidences.length >= 3)
- **≥ 2** different task types (incidentalTaskTypeCount >= 2)
- **Median confidence ≥ 0.7** (incidentalMedianConfidence >= 0.7)

So a word (e.g. "feel" or "feeling") must be observed **≥ 3 times** in total, in **≥ 2 task types**, with median confidence ≥ 0.7. If you see `taskTypes=[qa_prompt] (count=1)` and `confidences=[0.67]`, the node needs 2+ more incidental hits in another task type and/or higher confidence. Run `npx tsx src/scripts/inspect_last_attempt_nodes.ts` (без аргументов = все ноды последней попытки) или с словом для фильтра, чтобы увидеть candidateReady по каждому слову.

**Decay impact negative:** If UI shows "decay impact -6.5", the stored decayed score was above the current mean (alpha/beta had been corrected down). That’s stale state, not “strong decay”. We now cap so decay impact is never negative (shows as 0). **По-человечески:** в базе лежал «показываемый балл» 76, а внутренняя оценка уже упала до 69.5 — мы догнали отображение до реальности, поэтому балл «хуже». Не из‑за времени (decay), а потому что убрали устаревшее завышенное значение.

Then the planner prioritises that node for a **verification** task (explicit target). The node becomes **verified** when either: (1) one **direct** evidence with score ≥ 0.7, confidence ≥ 0.75, explicit target; or (2) **N-CCR early verification:** 2 direct successes in a row (score ≥ 0.7 each), even if mean &lt; 70. Streak is stored in `spacingStateJson.directSuccessStreak`; 2nd+ direct success in a row gets a 15% weight bonus (PFA-style: correct ≥0.6 → ×1.1, incorrect &lt;0.4 → ×0.9). So: incidental → candidate → (explicit target pass or 2 direct hits) → verified.

## B) Why skills don’t progress (no direct evidence)
## A2) How "too: +0.8" relates to mastery (why many pluses, low mastery)

**What the numbers are:**  
`Node mastery updates` show **deltaMastery** and **decayImpact** in the **same 0–100 scale** as the mastery score. So `too: +0.8 (decay impact 0.0)` means: *this attempt added 0.8 points to the mean of the "too" node* (e.g. 23 → 23.8). They **do** add up: each line is the change in that node's **mean** (Beta posterior) on this attempt.

**Why you see many pluses but mastery still low:**

1. **Scale:** Each +0.5 / +0.8 is **literally** 0.5–0.8 points on 0–100. So 10 such updates on the **same** node ≈ +5–8 points (e.g. 20 → 25–28). To get mastery 60–80 you need **many** attempts that hit the **same** nodes.

2. **Spread across nodes:** Usually each attempt touches **many** nodes (too, for, play, feel, …). So each node gets 1–2 evidences per attempt → small delta per node. Lots of lines = lots of nodes, each moving a little.

3. **Weight of evidence:** Mastery is updated with `alpha += weight * score`, `beta += weight * (1 - score)`. For **incidental/supporting** evidence, `weight` is ~0.2–0.35, so each evidence moves the mean only a bit. **Direct + explicit_target** has weight up to 1, so one strong hit can add several points.

4. **Decay:** The number you see in "Focus (next targets)" and in the skillset table is **decayedMastery**, not raw mean. It **decreases over time** when the node isn't practiced (half-life ~14 days for vocab). So: raw mean can grow (+0.8, +0.5, …), but if the node isn't practiced again for a while, **decayed** mastery goes down. Result: many pluses in the log, but the **displayed** mastery stays low until the same node is practiced again.

**Summary:** The pluses are real increments to the 0–100 mean. They are small per evidence and spread across many nodes; decay then reduces the **shown** value. To see high mastery: same nodes need repeated practice (many +0.5s on the same node) and/or strong direct evidence; otherwise decay will keep the displayed number low.

## B) Why skills don't progress (no direct evidence)
Progress and promotion depend on **direct** evidence (target nodes hit). Check:
1. **Evidence by kind:** Run `npx tsx src/scripts/inspect_recent_tasks.ts` and look at "Evidence by kind". If you see almost only `supporting` and `negative`, almost no `direct`, skills will not move.
2. **Cause for target_vocab:** "Word used" was matched only against the node’s descriptor/sourceKey. If the task prompt says "Use: school, learn" but the target GSE nodes have different descriptors (or the learner says "schools"/"learning"), we wrote `vocab_target_missing` (negative). Fix: we now bind **required words from the prompt** to target nodes by descriptor/alias and treat "learner used this required word" as evidence for the matching node (so we can write `vocab_target_used` = direct).
3. **Ensure prompt words match targets:** The task generator should include in the instruction the target words that correspond to the chosen nodes (e.g. from targetNodeLabels / curriculum) so that required words and target nodes align.

## C) Why score/progress looks wrong for one attempt
Inspect:
1. `Attempt.taskEvaluationJson`
2. `Attempt.nodeOutcomesJson`
3. `AttemptGseEvidence` rows for attempt
4. `TaskInstance.targetNodeIds`
5. linked `PlannerDecisionLog`

Expected chain:
`target nodes -> task prompt -> checks -> evidence -> mastery update`

If chain is broken, fix at the earliest broken link.

## D) Why strong extra language was not credited
Check:
1. alias coverage exists for words/phrases in transcript.
2. incidental evidence rows were written (`targeted=false`).
3. activation state moved (`observed` or `candidate_for_verification`).
4. planner scheduled verification tasks.

## E) Why stage did not move
Check:
1. `promotionStage` blockers (bundle/node labels).
2. verified coverage by domain.
3. reliability and stability gates.
4. direct evidence counts.

## E2) “0 nodes closed”, “nodes vs task words”, “why 17%?” (profile inspection)
**Script:** `npx tsx src/scripts/inspect_teacher_profile.ts [studentId]` — if no ID, uses the student with the most recent completed attempt.

1. **Why 0 nodes closed?**  
   A node counts as “closed” for promotion when it is **verified** and its mastery **value ≥ 70**. So 0 closed means: no node in the **target stage bundles** (A1 Grammar, A1 Vocab, A1 Can-Do) is both verified and at 70+. Typical case: nodes are still “observed” or “candidate_for_verification”, or verified but value &lt; 70. The script prints per bundle: “Closed: X / Y” and sample blockers (not verified or value &lt; 60).

2. **Why nodes in the UI differ from words in tasks?**  
   Two different sources:  
   - **Blocking nodes (Path to next level)** = fixed A1 (or target stage) **bundle** nodes from the GSE catalog (e.g. “Can say their age using ‘I’m [number]’”).  
   - **Words in tasks** (e.g. “use: play, feel”) = from **StudentVocabulary** (vocab due for review: new/learning lemmas).  
   The planner picks **GSE target nodes**; for `target_vocab`, **requiredWords** in the prompt come from the vocabulary queue, not from the bundle node list. So you see A1 Grammar/Can-Do descriptors in the block, but tasks may show different words from your vocab queue.

3. **What exactly gives 17%?**  
   Readiness score formula:  
   - `coverage * 60` (0 if no nodes at 70+ verified)  
   - `+ (reliability >= 0.65 ? 20 : 8)`  
   - `+ (stability >= 0.5 ? 10 : 3)`  
   - `+ min(10, round(confidence * 10))`  
   So **17% = 0 + 8 + 3 + 6**: coverage 0, reliability below gate (8), stability below 0.5 (3), confidence ~0.55 (6). The script prints this breakdown for the inspected student.

## E3) Do exercises affect “progress to next level”? (alignment)
**Short answer:** Yes. Progress counts only **bundle** nodes; planner **prefers** target-stage bundle nodes (after verification). If you show skills from **higher**-level nodes, we **lift** promotion so we don't show "A0" while you're on B1.
- **Progress bar** = only bundle nodes for target stage count as closed. **Planner** = prefers verification, then target-stage bundle nodes. **Placement lift** = if placement > bundle promotion, we set promotion = placement. Right now planner and progress use **different node sets**, so often they don’t align.

- **Progress bar / “X nodes closed”** = only nodes from the **fixed bundles** for the target stage (e.g. A1 Grammar Core = 12 specific nodes, A1 Vocab Core = 16, A1 Can-Do = 14). Only those 42 nodes count as “closed” when verified and value ≥ 70.
- **Planner (what exercise you get)** = chooses from **any** GSE nodes in the stage band where you already have some mastery (plus verification queue). That pool can be dozens or hundreds of nodes, and **many of them are not in the bundle**.
- So you can do exercises, get evidence, raise mastery on “make”, “too”, “good”, etc., but if those nodes are **not** among the 12+16+14 bundle nodes, the “path to next level” counter does **not** move. The exercises are not “pointless” (they grow your skills and can lead to verification on other nodes), but they are **not guaranteed** to be the same nodes that fill the progress bar.

**Done:** (1) When **placement** (weighted evidence from all nodes) is **above** bundle-based promotion, we now **lift promotion** to placement so the UI doesn’t show “A0” while the learner is already working on B1 nodes. (2) Planner **prefers** target-stage bundle nodes (after verification queue) so tasks align with “path to next level”. See TASKS “What was just fixed”.

## F) Task generator: why prompt sent “garbage” (raw node IDs)
The task generator LLM used to receive only raw GSE node IDs (e.g. `gse:gse_grammar_glgr:...`), which are meaningless to the model. Now:
- Planner returns **targetNodeDescriptors** (human-readable learning objectives) together with targetNodeIds.
- The prompt sent to the LLM uses **Target learning objectives** (numbered list of descriptors) and asks to copy the given IDs into `target_nodes` in the JSON. So the model designs the task from the objectives, not from opaque IDs.
- Grammar nodes with empty or "No grammar descriptor available." are shown as "Grammar accuracy at this level" in the prompt and in selection reason.

If you still see bad prompts in LangSmith, check that `decision.targetNodeDescriptors` is passed into `generateTaskSpec` as `targetNodeLabels` (see `GET /api/task/next`).

## G) Debugging LLM prompts (LangSmith)
All OpenAI calls (evaluator + task generator) go through LangChain. To trace prompts and responses:

1. Get an API key at https://smith.langchain.com (sign up free).
2. In `.env` set:
   - `LANGCHAIN_TRACING_V2=true`
   - `LANGCHAIN_API_KEY=<your_langsmith_api_key>`
   - Optionally `LANGCHAIN_PROJECT=duma_english` (project name in LangSmith).
3. Restart dev server and/or worker. Each LLM run will appear in LangSmith: full prompt, response, latency, token usage.
4. **Проверка:** открой в браузере `GET /api/debug/langsmith-test` (например http://localhost:3000/api/debug/langsmith-test). Это сделает один тестовый вызов LLM; через несколько секунд он должен появиться в LangSmith. В ответе API будет подсказка, включён ли трейсинг и задан ли ключ.
5. Use filters by run name or project to find evaluator vs task-generator runs.

Without these env vars, the app works as before; tracing is off.

## H) Mandatory checks before saying “fixed”
1. `npm test`
2. `npm run lint`
3. `npm run build`
4. Re-run one real attempt and inspect evidence + node outcomes.
