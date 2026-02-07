# TASKS: Autonomous English Trainer Roadmap (A1 -> C2 + Stage Speaking)

## Execution Log (последнее обновление)
- GSE Brain v5 (implemented):
  - Added non-target language capture:
    - incidental `GSE_VOCAB` evidence from transcript words via `sourceKey + aliases`
    - incidental `GSE_GRAMMAR` evidence from grammar checks mapped to grammar nodes
  - Added activation lifecycle in mastery:
    - `observed -> candidate_for_verification -> verified`
    - verification requires direct explicit evidence (`score >= 0.7`, `confidence >= 0.75`)
  - Promotion now counts verified nodes only (bundle coverage/reliability/stability use `activationState=verified`)
  - Planner verification priority:
    - surfaces candidate nodes and injects verification gain into utility
    - exposes `selectionReasonType` and `verificationTargetNodeIds`
  - API/UI explainability extensions:
    - attempts: `incidentalFindings[]`, `activationTransitions[]`
    - progress: `observed/candidate/verified` counters + `verificationQueue[]`
  - Schema/migration:
    - `StudentGseMastery`: `activationState`, `supportingEvidenceCount`, `incidentalTaskTypeCount`, `verificationDueAt`
    - `AttemptGseEvidence`: `targeted`, `activationImpact`
    - migration: `20260207213000_gse_brain_v5_observed_verified`
- Brain-focus update (GSE v3/v4 continuation):
  - Evidence consistency v2.1:
    - в `TaskEvaluation` добавлены стабильные `loChecks[]` и `grammarChecks[]`
    - в `gse/evidence` введен check-level mapping + `metadataJson` (`checkId`, `ruleVersion`, `consistencyFlag`)
    - добавлено правило `lo_check_negative_required` для low task score при explicit target
  - Results/attempt API расширены:
    - `evidenceMatrix[]` и `consistencyFlag` в `/api/attempts/:id`
  - Stage explainability усилена:
    - `placementStage` и `promotionStage` явно разделены в прогрессе
    - добавлен `whyDifferent` и человекочитаемые причины blockers
  - Quality loop operationalized:
    - `src/lib/gse/quality.ts`
    - endpoint `GET /api/quality/gse`
    - пороговые quality-gates: `lowScoreWithoutNegativeRate`, `grammarOverweightRate`, `vocabFalsePositiveRate`
- Удалена legacy skill-модель из схемы:
  - удалены `StudentSkillDaily`, `StudentSkillMastery` из Prisma schema
  - добавлена миграция `20260207204000_drop_legacy_skill_tables`
- Sprint 6 (in progress): observability + quality hardening
  - добавлено событие `node_update_applied` после применения evidence к node mastery
  - добавлено событие `promotion_blocked_bundle` при stage refresh
  - добавлен latency snapshot для planner (`planner_latency_snapshot`, p50/p95/p99)
  - добавлен QA-скрипт `npm run gse:qa` (`src/scripts/gse_quality_checks.ts`)
  - в `evidence.ts` добавлена age-band calibration (`6-8`, `9-11`, `12-14`) для весов evidence
  - исправлен расчет причины `coverage` в bundle blockers
- Реализован adaptive placement (CAT/IRT-lite):
  - `placement_item` bank (seed A0..C2, 5 core skills)
  - online update `theta/sigma`
  - stop-rule: `min 6`, `sigma<=0.35` или `max 14`
  - API теперь возвращает `theta`, `sigma`, `nextItem`, `whyThisItem`
- Добавлены сущности/поля placement:
  - `PlacementItem`, `PlacementResponse`
  - расширение `PlacementSession` (`theta`, `sigma`, `questionCount`, `askedItemIds`, `currentItemId`, ...)
  - расширение `LearnerProfile` (`placementFresh`, `placementUncertainNodeIds`, `placementCarryoverJson`)
  - миграция: `20260207170000_adaptive_placement_irt` применена
- Реализован auto-carryover A1/A2 bundles для B2+ при confidence gate:
  - synthetic mastery update в `StudentGseMastery`
  - carryover summary сохраняется в профиль
- Подключен planner handoff:
  - `/api/task/next` учитывает `placementFresh` + `placementUncertainNodeIds`
  - preferred nodes передаются в decision engine
- Обновлены UI/роуты placement:
  - `/placement` показывает ability/uncertainty и completion summary
  - `/api/placement/*` контракты обновлены под adaptive mode
- Worker обновлен:
  - placement answer пишется по `placementItemId`
  - auto-finish placement при `done`
  - `placementFresh` сбрасывается после первого обычного (не placement) completed attempt
- Внедрен `Product Brain v1` каркас (decision loop):
  - `PlannerDecisionLog`, `TaskInstance`, `PromotionAudit`
  - `Attempt.nodeOutcomesJson`, `Attempt.recoveryTriggered`
  - расширение `StudentGseMastery` (`masteryMean`, `masterySigma`, `decayedMastery`, `halfLifeDays`)
- Добавлен decay-aware + Bayesian-like update в `src/lib/gse/mastery.ts`.
- Добавлена explainability цепочка:
  - `nodeOutcomes` в результате попытки
  - planner reason/expected gain в `GET /api/task/next`
  - `GET /api/planner/decision/:id` и `POST /api/planner/simulate`
- Добавлен LLM-first task generator с strict schema и fallback:
  - `src/lib/taskGenerator.ts`
- Добавлен recovery trigger в worker (серия слабых task attempts / падение confidence).
- Прогресс расширен:
  - `nodeCoverageByBand`, `overdueNodes`, `uncertainNodes`, `promotionReadiness`, `weeklyFocusReason`
- Promotion gate больше не основан только на среднем балле:
  - `coverage + stability + reliability`
  - аудит решения пишется в `PromotionAudit`.
- Введены таблицы и связи `gse_*`:
  - `gse_catalog_versions`, `gse_nodes`, `gse_node_aliases`, `gse_node_edges`
  - `attempt_gse_evidence`, `student_gse_mastery`, `task_gse_targets`
- Добавлен ingestion foundation:
  - `src/lib/gse/catalog.ts`
  - `src/lib/gse/importers.ts` (CSV/XLSX/PDF adapters)
  - `src/lib/gse/merge.ts`, `src/lib/gse/utils.ts`, `src/lib/gse/types.ts`
- Добавлен GitHub ingestion adapter:
  - `src/lib/gse/github.ts` (repo tree scan, parse JSON/CSV/TSV/SQLite)
  - bootstrap-режим для `ruupert/gse_analyser` через публичный toolkit API
  - CLI: `npm run gse:import:github`
- Выполнен импорт из репозиториев:
  - `ruupert/gse_analyser` + `fildpauz/vocab-lists`
  - результат: `imported=35762`, `created=24174`, `updated=11588`
- Добавлен официальный API scraper (без curl-заглушек):
  - `src/lib/gse/officialApi.ts` (пагинация, retry/backoff, маппинг vocab/grammar/LO)
  - `src/scripts/gse_import_from_official_api.ts`
  - npm script: `npm run gse:import:official`
- Выполнен полный импорт из official API:
  - vocabulary: `40045`
  - grammar: `456`
  - learning objectives: `1413`
  - mapped total: `41914`
  - refresh result: `created=40227`, `updated=1687`
- Добавлены API:
  - `POST /api/gse/catalog/refresh`
  - `GET /api/gse/node/:id`
  - `GET /api/gse/catalog/version`
- Подключен node-targeting в выдачу задач:
  - `GET /api/task/next` возвращает `targetNodeIds`, `selectionReason`
- Подключена запись evidence и mastery в worker:
  - `src/lib/gse/evidence.ts`
  - `src/lib/gse/mastery.ts`
- Расширены результаты и прогресс:
  - `/api/attempts/:id` -> `gseEvidence[]`, `language` блок
  - `/api/progress` -> `nodeProgress`
  - UI: `/results`, `/progress`, `/task` обновлены
- Добавлены unit-тесты для GSE foundation:
  - `src/lib/gse_merge.test.ts`
  - `src/lib/gse_mastery.test.ts`
- Проверки:
  - `npm test` ✅
  - `npm run lint` ✅
  - `npm run build` ✅

## Current Active Focus (brain-only)
1. Закрыть quality action loop:
- при breach quality threshold автоматически включать corrective policy на домен (`vocab|grammar|lo`) в planner utility (не только в выборе task type).
2. Усилить promotion объяснимость:
- каждое blocked condition должно ссылаться на конкретные bundle/node labels + численные пороги.
3. Довести evidence-mastery согласованность:
- consistency rule failures должны логироваться отдельным событием и попадать в quality report.

## 0) Правило исполнения (обязательно)
- Двигаемся сверху вниз по этому файлу.
- Любые новые идеи сначала фиксируем в этом файле, потом реализуем.
- Не делать побочные улучшения вне текущего этапа.
- Каждый этап закрывается только после `npm test`, `npm run lint`, `npm run build` и ручного smoke.

## 1) North Star и критерии полноценного продукта
- Продукт автономно ведет ребенка от A1 до C2 без учителя.
- Каждый день система выдает персональный план и объясняет "почему это упражнение сейчас".
- Оценка прозрачна: за каждый балл есть факты (артефакты, evidence, reliability).
- Прогресс измеряется по навыкам, а не только по одному overall score.
- Трек публичных выступлений доводит до уверенной речи "на сцене".

## 2) Что нам сейчас не хватает (gap list)

### 2.1 Assessment (главный разрыв)
- Нет полноценной грамматики как отдельного скилла:
  - `grammar_accuracy`
  - `grammar_error_types` (articles, tense, agreement, prepositions, word order)
  - `error_spans + fix_suggestion`
- Нет полноценной дискурсивной оценки для B2-C2:
  - coherence/cohesion
  - argument quality
  - register/style control
- Недостаточно зрелая калибровка task-score:
  - разная стабильность между task type
  - редкие schema-fail OpenAI уходят в rule fallback
- Недостаточный coverage для advanced speaking:
  - rebuttal, persuasion, debate, Q&A pressure, storytelling depth

### 2.2 Curriculum/learning loop
- Пока нет полного CEFR path до C2 (сейчас база до B1/A2-уровня задач).
- Нет полноценного stage-gate с правилами промоушена на B2/C1/C2.
- Нет долговременного mastering loop по грамматике/лексике/риторике.
- Нужен полноценный adaptive planner с weekly objectives и recovery-планом.

### 2.3 Autonomous coaching
- Нужен "AI coach" режим без учителя:
  - постановка недельной цели
  - ежедневный мини-план
  - объяснение ошибок понятным языком для детей
  - выбор следующего шага при слабом скилле
- Нужен conversational tutor (мультитуровый диалог с адаптацией сложности).

### 2.4 Public speaking track
- Нет полной лестницы от коротких ответов к выступлению 3-5 минут.
- Нет детской системы обучения структуре речи (без методического жаргона).
- Нет рубрики сценической речи:
  - opening impact
  - clarity
  - pacing
  - audience engagement
  - Q&A handling

## 3) Целевая модель навыков (канон для progression)

### 3.1 Core skills (всегда)
- `pronunciation`
- `fluency`
- `tempo_control`
- `vocabulary`
- `grammar`
- `task_completion`

### 3.2 Advanced skills (B2+)
- `coherence`
- `argumentation`
- `register_control`
- `audience_engagement`
- `qa_handling`

### 3.3 Для каждого skill храним
- `value` (0-100)
- `source` (`azure|rules|openai`)
- `reliability` (`high|medium|low`)
- `sampleCount`
- `delta7`, `delta28`
- `calculationVersion`

## 4) Полный план реализации (строго по этапам)

## Этап A: Assessment v4 (честная и полная оценка)
### Цель
- Сделать оценку речи объяснимой и достаточно точной для A1-C2.

### Задачи
- Добавить grammar evaluator (OpenAI JSON schema + deterministic fallback).
- Добавить grammar artifacts:
  - `grammarAccuracy`
  - `errorCountByType`
  - `topErrors[]` (source span, corrected form, short explanation).
- Добавить discourse evaluator для B2+:
  - `coherenceScore`
  - `argumentScore`
  - `registerScore`
- Для read-aloud стабилизировать PA pipeline:
  - `target_ref_pa` и `self_ref_pa` как отдельные метрики.
- Пересобрать scoring:
  - `speechScore`, `languageScore`, `taskScore`, `overallScore`
  - strict reliability gating.

### DoD
- Ни одна метрика не рендерится без реального источника.
- Grammar видна как отдельная карточка и как skill trend.
- Schema-fail OpenAI не ломает результат (fallback всегда валиден).

## Этап B: CEFR curriculum до C2
### Цель
- Полный путь A1->A2->B1->B2->C1->C2 c возрастной адаптацией.

### Задачи
- Добавить CEFR descriptor matrix до C2 по всем skill.
- Расширить task library:
  - A1-A2: simple topic talk, vocab tasks, guided Q&A
  - B1-B2: role-play, opinion talk, structured response
  - C1-C2: debate, persuasion, critical response, abstract topics
- Ввести stage-gate rules:
  - promo только при стабильных skill thresholds
  - fail-safe при низкой reliability.
- Ввести mastery policy:
  - минимум evidence per skill
  - sustained improvement 2+ weeks.

### DoD
- `/api/learning-path` выдает корректный план для всех стадий до C2.
- Нет задач "выше головы" текущего stage.

## Этап C: Autonomous AI Coach
### Цель
- Ребенок занимается полностью самостоятельно, система ведет процесс.

### Задачи
- Реализовать daily coach loop:
  - daily goal
  - 3-5 tasks/day
  - объяснение фокуса дня.
- Добавить weekly review:
  - что выросло
  - что просело
  - план на следующую неделю.
- Добавить fallback coach rules при недоступности OpenAI.
- Сделать возрастные шаблоны объяснений:
  - 6-8
  - 9-11
  - 12-14.

### DoD
- После каждого completed attempt есть конкретный next step.
- В Progress есть "главный фокус недели" + причина.

## Этап D: Conversational Tutor (multi-turn)
### Цель
- Тренировать живой разговор, а не только монолог.

### Задачи
- Ввести session-based dialogue tasks:
  - 4-10 turns
  - context memory
  - persona/scenario engine.
- Добавить turn-level scoring:
  - relevance
  - response latency
  - clarification behavior
  - follow-up quality.
- Добавить role difficulty ladder (easy -> challenging partner).

### DoD
- Есть end-to-end сценарии диалога с измеримым прогрессом.
- Метрики диалога добавлены в progress skills.

## Этап E: Public Speaking Track (stage-ready)
### Цель
- Довести до уверенного выступления перед аудиторией.

### Задачи
- Лестница выступлений:
  - 30s -> 60s -> 90s -> 120s -> 180s+
- Детские инструкции структуры речи:
  - "Начало"
  - "Главная мысль"
  - "Пример"
  - "Финал"
- Ввести rubrics:
  - structure
  - voice clarity
  - pace control
  - engagement
  - Q&A response.
- Ввести rehearsal mode:
  - first run
  - coached run
  - final run with delta report.

### DoD
- Для speech-track есть отдельный progression graph.
- Feedback для stage speaking не generic, а rubric-grounded.

## Этап F: Safety, Trust, Anti-cheat
### Цель
- Безопасный и честный автономный продукт для детей.

### Задачи
- Content moderation (input/output).
- PII redaction и минимизация хранения чувствительных данных.
- Anti-cheat signals:
  - suspiciously perfect transcript-patterns
  - repeated canned answers
  - playback/TTS hints.
- Parent-safe settings:
  - topic allowlist
  - restricted themes.

### DoD
- Есть инцидент-классификация и блокировка unsafe output.
- Есть отчеты по suspicious attempts.

## Этап G: Calibration + Quality Ops
### Цель
- Стабильность оценок между возрастами, акцентами и уровнями.

### Задачи
- Golden dataset attempts (A1-C2, age bands, accents).
- Offline eval pipeline:
  - parser correctness
  - score consistency
  - feedback quality rubric.
- Drift monitoring:
  - weekly regressions
  - scorer version comparison.
- Feature flags + canary release для scorer changes.

### DoD
- Любое изменение scoring проходит benchmark-gate.
- Виден quality dashboard по ключевым метрикам.

## Этап H: Product analytics + growth loop
### Цель
- Продукт доказуемо улучшает речь и удерживает ученика.

### Задачи
- Метрики продукта:
  - D1/D7/D30 retention
  - attempts per week
  - skill uplift (delta28)
  - stage promotion rate
  - public speaking completion rate.
- Alerting:
  - dropout risk
  - stalled progress
  - low reliability cohorts.
- Adaptive re-engagement:
  - easy-win tasks
  - confidence-recovery sessions.

### DoD
- Есть дашборд эффективности обучения и воронка прогресса.

## 5) Изменения в модели данных/API (обязательные)
- Добавить grammar/discourse поля в `attemptMetrics`.
- Добавить storage для grammar artifacts (span-level corrections).
- Расширить `studentSkillDaily` для новых skill keys.
- Расширить `/api/attempts/:id`:
  - grammar block
  - discourse block
  - stage-speaking block.
- Расширить `/api/progress`:
  - core + advanced skills
  - readiness индексы (conversation readiness, stage readiness).

## 6) Definition of Done для "полноценного автономного продукта"
- Ученик может пройти путь A1->C2 без учителя по персональному плану.
- Все ключевые навыки имеют тренды и понятные действия "что делать дальше".
- Feedback не содержит пустых или недоказанных утверждений.
- Есть полноценный трек сценической речи с измеримым ростом.
- Система устойчива к отказам AI провайдера (fallbacks).
- Безопасность для детей и anti-cheat активны по умолчанию.

## 7) Текущий статус (сохранение контекста из прошлых итераций)
- Placement + прогресс-база реализованы и проверены.
- Baseline навыков пишется в `studentSkillDaily` при завершении placement.
- Следующий инженерный шаг: старт Этапа A (Assessment v4) с грамматикой.

## 8) Порядок старта "прямо сейчас" (next 3 execution blocks)
1. Реализовать grammar evaluator + schema + fallback + UI cards.
2. Расширить scoring pipeline (language/discourse/reliability gating).
3. Обновить `/api/progress` под новые skills и weekly coach focus.

---

## 9) Execution Log (2026-02-07, GSE Brain v5 follow-up)

### Сделано
1. Исправлен корневой баг vocab mapping:
- в `src/lib/gse/evidence.ts` матчинг переведен с `sourceKey` (тех-ID) на человеческие лексемы (`descriptor/alias`) + лемматизация.
2. Добавлен incidental vocab capture v2:
- поддержка unigram/bigram/trigram кандидатов из transcript;
- фильтр stopwords для снижения мусорных совпадений.
3. Усилен grammar capture:
- в `src/lib/evaluator.ts` добавлены rule-based grammar checks (positive + negative), включая agreement ошибки.
- в `src/lib/gse/evidence.ts` non-target grammar теперь пишет не только supporting, но и negative incidental evidence.
4. Добавлена автогенерация алиасов узлов:
- `src/lib/gse/catalog.ts` теперь строит и пишет `GseNodeAlias` (`source=auto`) при обновлении каталога.
5. Добавлен и выполнен backfill алиасов:
- новый скрипт `src/scripts/gse_backfill_aliases.ts`;
- npm script: `gse:aliases:backfill`;
- фактически заполнено ~240k auto aliases в локальной БД.
6. Добавлены тесты:
- `src/lib/gse_evidence_v2.test.ts`: проверка target vocab matching по descriptor при тех-ID в sourceKey.

### Проверки
1. `npm test` — pass.
2. `npm run lint` — pass.
3. `npm run build` — pass.

### Следующий шаг (по мозгу, без отвлечений)
1. Ограничить incidental vocab disambiguation:
- когда один alias матчится к множеству нод, оставлять top-k по близости GSE band + task context.
2. Ввести явный verification loop UI/API:
- `candidate_for_verification` -> приоритетная проверочная задача -> `verified`.
3. Пересчитать promotion readiness после накопления verified evidence и показать разницу до/после в progress.
