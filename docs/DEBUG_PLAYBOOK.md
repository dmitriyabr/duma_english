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

3. **Weight of evidence:** Mastery is updated with `alpha += weight * score`, `beta += weight * (1 - score)`. **Supporting+incidental** и **direct+explicit_target** имеют baseWeight 1; effectiveWeight = baseWeight × conf × rel × impact. При одинаковых conf/rel/impact прирост одинаковый (плюс streak для direct при 2+ подряд).

4. **Decay:** The number you see in "Focus (next targets)" and in the skillset table is **decayedMastery**, not raw mean. It **decreases over time** when the node isn't practiced (half-life ~14 days for vocab). So: raw mean can grow (+0.8, +0.5, …), but if the node isn't practiced again for a while, **decayed** mastery goes down. Result: many pluses in the log, but the **displayed** mastery stays low until the same node is practiced again.

**Summary:** The pluses are real increments to the 0–100 mean. They are small per evidence and spread across many nodes; decay then reduces the **shown** value. To see high mastery: same nodes need repeated practice (many +0.5s on the same node) and/or strong direct evidence; otherwise decay will keep the displayed number low.

**Why +10.9 on "think" but +0.5 on "play" if weight is only 2× different?**  
See "Why old nodes grow so slowly" below.

**Why do old nodes (play, for, too) grow so slowly?**  
Mastery = 100×α/(α+β). Each evidence: α += weight×score, β += weight×(1−score), so **α+β каждый раз растёт**.  
1. **Мало доказательств (новая нода):** α+β маленькая → прирост большой (+10).  
2. **Много доказательств (старая нода):** α+β большая → прирост маленький (+0.5).  

**Fix (bounded memory):** α+β ограничены сверху (cap **12**), чтобы каждый evidence давал видимый прирост: при streak ×1.56 не +0.6, а **~2+** балла. До 70 реально добраться за 15–25 повторений.

**Ориентир при cap 12:** один evidence при cap — supporting и direct при одинаковых conf/rel/impact дают одинаковый прирост (~5–12 баллов в зависимости от streak). Порог «closed» value ≥ 70.

## A3) Evidence mix and streak
Run **`npx tsx src/scripts/inspect_profile_evidence.ts [studentId]`** to see your evidence mix. Streak applies to both direct and supporting success. Supporting and direct: baseWeight 1, same formula (conf×rel×impact). Most evidence is **supporting + incidental** (word used in speech but task was not target_vocab with that word). Streak applies only when **kind=direct** and score≥0.7, so with almost no direct evidence you rarely see “streak ×1.15”. See MASTERY_METHODOLOGY for spec. See MASTERY_METHODOLOGY.md “Why you see so few streaks”.

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

## D2) Why semantic LO/Grammar incidental did not appear
Check:
1. `OPENAI_API_KEY` is set and `GSE_SEMANTIC_ENABLED=true`.
2. `GseNodeEmbedding` has vectors for `GSE_LO` and `GSE_GRAMMAR` candidates.
3. Evaluation produced LO/grammar checks (see `Attempt.taskEvaluationJson.loChecks` / `.grammarChecks`).
4. confidence threshold was met (`GSE_SEMANTIC_CONF_THRESHOLD`, default `0.68`).
5. matched node was not already targeted in `TaskGseTarget`.

Debugging tip:
- Enable local pipeline log: set `PIPELINE_DEBUG_LOG_ENABLED=true` and inspect `tmp/pipeline-debug.ndjson` for `semantic_parser_*`, `semantic_retrieval_*`, `evaluation_*` events.

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
   - `coverage * 60` (0 if no nodes verified with value≥70)  
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


## E4) Откуда берутся ноды заданий (пул, выбор, пример по твоему профилю)

**Проверять по базе, не «судя».** Скрипт: `npx tsx src/scripts/inspect_planner_flow.ts [studentId]` — выводит stage из БД, пул нод, ноды бандла B1, последние 5 решений планировщика.

**Как устроено (простыми словами):**

1. **Stage берётся из базы:** `projectLearnerStageFromGse(studentId)` → `promotionStage` (текущий уровень, напр. A2) и `targetStage` (следующий, напр. B1). Никаких «судя» — только эти поля.

2. **Пул нод (loadNodeState):** планировщик грузит только те ноды, по которым у ученика уже есть строка в **StudentGseMastery** и у которых **gseCenter** в диапазоне текущего стейджа ± 5 (для A2 это 25–47). То есть в пул попадают только ноды, по которым уже был хотя бы один evidence. Остальных нод в пуле **нет**.

3. **Ноды бандла B1:** это фиксированный список nodeId из бандлов целевого стейджа (Grammar Core, Can-Do Core, Vocab Core для B1). Они нужны для «path to next level»: прогресс по ним даёт node progress и readiness. Планировщик **предпочитает** их (preferredNodeIds), но выбирать может **только из пула**. Если в пуле нет ни одной ноды из бандла B1, то ни одна такая нода не будет выдана — предпочтение бесполезно.

4. **Выбор задания:** из пула (nodeStates) считается utility по типам заданий и нодам; preferred (верификация, потом target-stage bundle) повышает оценку. Выбирается пара (тип задания, до 3 нод). **targetNodeIds** всегда только из пула.

**Конкретно по твоему профилю (данные из скрипта):**

- **Stage из БД:** promotionStage = A2, targetStage = B1. GSE для A2: 30–42.
- **Пул:** 50 записей StudentGseMastery в диапазоне 25–47. **Ни одна из этих 50 нод не входит в бандлы B1** (это в основном vocab: learner, learn, girl, say, girlfriend, example и т.д. с gseCenter 28–46).
- **Бандл B1:** 62 ноды (грамматика/can-do типа "Can use 'all of'...", gseCenter 43–44). По ним у тебя **нет** записей в StudentGseMastery, поэтому они **не в пуле**.
- **Последние 5 заданий:** все target ноды — из пула (learner, learn, girl, say, girlfriend, example); **0 из бандла B1**.
- **Итог:** тебе не дают ноды из бандлов B1, потому что их нет в пуле. Node progress к B1 = 0%, потому что по обязательным B1-нодам нет evidence.

**Как должно быть:** в пул планировщика должны попадать и ноды целевого стейджа (B1) из бандлов, даже если по ним ещё нет mastery — с «нулевым» состоянием (decayedMastery 0, observed). Тогда их можно выбирать, давать задания, накапливать evidence и поднимать node progress. После фикса планировщика скрипт `inspect_planner_flow.ts` покажет ноды B1 в пуле и в последних решениях.

## E5) Рассинхроны (два источника правды)

Места, где раньше или до сих пор два разных источника данных могли расходиться. Правило: **один источник правды на контекст** (на задание — ноды и слова из планировщика; на прогресс — бандлы и mastery).

**Исправлено:**

1. **target_vocab: слова в задании vs ноды** — раньше prompt/requiredWords из StudentVocabulary, target nodes из планировщика → штраф за слова, которые не просили. Теперь слова в промпте и requiredWords выводятся из **targetNodeDescriptors** планировщика; fallback на vocab queue только если &lt; 2 дескрипторов.
2. **assignTaskTargetsFromCatalog** — preferredNodeIds всегда **decision.targetNodeIds**. LLM не знает про ID: в промпт ему передаём только слова/цели (target words, learning objectives), в схеме ответа нет target_nodes. Ноды к заданию привязываем только из планировщика.
3. **GET /api/task/next ответ targetWords** — раньше в ответе отдавался список из vocabDue, а в задании — слова из нод. Теперь для target_vocab в ответе отдаются **promptTargetWords** (те же, что в промпте).

**Проверить / оставить в уме:**

4. **Learning path API** (`/api/learning-path`) — возвращает targetWords из StudentVocabulary (леммы к повторению). Это список «слов в очереди», а не «слова следующего задания». Если в UI показывать его как «слова следующего задания» — будет рассинхрон; лучше подписывать как «слова к повторению» или брать слова из следующего task/next.
5. **Stage** — везде должен браться из `projectLearnerStageFromGse` (promotionStage / placementStage). Если где-то подставляют stage из профиля или хардкод — возможен рассинхрон с прогрессом и пулом нод.
6. **Генератор заданий** — LLM не видит и не возвращает node ID. Ему передаём только слова/цели (target words, learning objectives); в JSON запрашиваем instruction, constraints и т.д., без target_nodes. Целевые ноды всегда из планировщика (decision.targetNodeIds). Так модель не может перепутать ID и промпт не усложняем.

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

## G2) Debugging vocab matching (lemma + candidates)
Vocabulary matching has non-LLM steps (lemmatization + lexical retrieval), so you will not see them in LangSmith.

To inspect inputs/outputs for each step, enable the pipeline debug log:
1. In `.env`: `PIPELINE_DEBUG_LOG_ENABLED=true`
2. Optionally: `PIPELINE_DEBUG_LOG_PATH=tmp/pipeline-debug.ndjson`
3. Re-run an attempt and inspect `tmp/pipeline-debug.ndjson` (NDJSON events).

Key events:
- `lemma_service_request` / `lemma_service_response` / `lemma_service_error`
- `vocab_retrieval_phrase_candidates`
- `vocab_retrieval_candidates`
- `evaluation_prompt_inputs` (includes `vocabRetrieval` + the exact prompt inputs)

Notes:
- `evaluation_prompt_inputs` separates `Target ... options` vs `Candidate ... options`. Candidate options should not duplicate target options for LO/grammar/vocab.
- `GSE_VOCAB_CATALOGS` affects incidental vocab retrieval only. Explicit task targets come from `TaskGseTarget` and can include nodes from other catalogs unless the planner is restricted.

To use spaCy (higher-quality lemmas), start the optional lemma service and set:
- `LEMMA_SERVICE_URL=http://localhost:8099`
- `docker compose --profile nlp up -d lemma_service`

## H) Mandatory checks before saying “fixed”
1. `npm test`
2. `npm run lint`
3. `npm run build`
4. Re-run one real attempt and inspect evidence + node outcomes.
