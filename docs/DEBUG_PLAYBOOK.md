# DEBUG PLAYBOOK (Brain)

Last updated: 2026-02-07

## A) Why score/progress looks wrong for one attempt
Inspect:
1. `Attempt.taskEvaluationJson`
2. `Attempt.nodeOutcomesJson`
3. `AttemptGseEvidence` rows for attempt
4. `TaskInstance.targetNodeIds`
5. linked `PlannerDecisionLog`

Expected chain:
`target nodes -> task prompt -> checks -> evidence -> mastery update`

If chain is broken, fix at the earliest broken link.

## B) Why strong extra language was not credited
Check:
1. alias coverage exists for words/phrases in transcript.
2. incidental evidence rows were written (`targeted=false`).
3. activation state moved (`observed` or `candidate_for_verification`).
4. planner scheduled verification tasks.

## C) Why stage did not move
Check:
1. `promotionStage` blockers (bundle/node labels).
2. verified coverage by domain.
3. reliability and stability gates.
4. direct evidence counts.

## E) Debugging LLM prompts (LangSmith)
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

## F) Mandatory checks before saying “fixed”
1. `npm test`
2. `npm run lint`
3. `npm run build`
4. Re-run one real attempt and inspect evidence + node outcomes.
