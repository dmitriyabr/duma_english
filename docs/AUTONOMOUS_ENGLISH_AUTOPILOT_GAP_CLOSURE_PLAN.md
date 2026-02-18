# Autonomous English Autopilot: Gap Closure Execution Board

Last updated: 2026-02-17
Source baseline: `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_BLUEPRINT.md` + current code/docs (`README.md`, `TASKS.MD`, `docs/BRAIN_RUNTIME.md`)

## 0) Working Protocol

Работа ведётся в одной ветке: `codex/autopilot-execution-plan`.

Файлы процесса:
1. Файл задач: `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_GAP_CLOSURE_PLAN.md`
2. Файл общения: `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md`

Статусы задач:
1. `TODO`
2. `IN_PROGRESS`
3. `BLOCKED`
4. `DONE`

Обязательный цикл шага:
1. Перед шагом агент читает файл общения `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md`.
2. После шага агент обязательно пишет сообщение в этот файл.
3. Текст сообщения свободный.

Обновление статуса задачи:
1. Старт задачи: `TODO -> IN_PROGRESS` + `Owner` + `Start (UTC)`.
2. Блокер: `IN_PROGRESS -> BLOCKED` + короткая причина.
3. Завершение: `IN_PROGRESS -> DONE` + `End (UTC)` + commit hash в реестре.
4. Переход статуса выполняется отдельно по каждой задаче сразу в момент события.

Контекст перед началом работы:
1. `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_BLUEPRINT.md`
2. `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_GAP_CLOSURE_PLAN.md`
3. `README.md`
4. `TASKS.MD`
5. `docs/BRAIN_RUNTIME.md`
6. `docs/BRAIN_ROADMAP.md`
7. `docs/DEBUG_PLAYBOOK.md`

## 1) Стартовая точка (сегодня)

Что уже есть в продукте:
- GSE-first планировщик задач и explainability по target nodes.
- Pipeline `speech -> retry gates -> evaluation -> evidence -> mastery -> progress`.
- Retry-гейты (`speech` + `topic`) с инвариантом `needs_retry` без мутации mastery.
- Семантический incidental pipeline для `LO/Grammar/Vocab`.
- Node lifecycle (`observed -> candidate_for_verification -> verified`) и verification queue.
- Bundle-based promotion, teacher/student UI, placement (IRT + extended).

Главные разрывы до blueprint world-class состояния:
- Нет causal error model с распределением причин и disambiguation probes.
- Нет transfer/OOD контура с difficulty matching и milestone stress gates.
- Нет learned policy цикла (reward trace, replay, OPE, shadow promotion).
- Нет обязательного self-repair цикла с delayed non-duplicate verification.
- Нет retention-контуров 7/30/90 как hard gate.
- Нет CEFR coverage contract `descriptor -> node -> task -> rubric`.
- Нет полноценных C1/C2 discourse/pragmatics движков.
- Продукт в основном speaking-first, не закрывает full 4-skill C2 target.

## 2) Правило закрытия изменений

Каждое изменение ниже закрывается только при одновременном выполнении:
1. Код/миграции в `codex/autopilot-execution-plan` (через PR) и merge-ready для `main`.
2. Автотесты/регрессии для новой логики.
3. Наблюдаемость (метрики/логи/API поля) для контроля в проде.
4. Явный артефакт проверки (`script`, `dashboard`, `endpoint`, `report`).

## 3) Критический путь (без спринтов, только зависимости)

1. Сначала `CH-01..CH-06` (контракт данных и контроля).
2. Затем параллельно: causal (`CH-07..CH-12`) и transfer (`CH-13..CH-18`).
3. После этого policy learning (`CH-19..CH-24`) и self-repair+retention (`CH-25..CH-30`).
4. Затем localization/discourse/modality expansion (`CH-31..CH-39`).
5. В финале governance + rollout hardening (`CH-40..CH-45`).

## 3.1) Стартовый seed (параллельно и изолированно)

Стартуем с:
1. `CH-01` — CEFR coverage matrix contract.
2. `CH-02` — Data model v2.
3. `CH-05` — KPI contract + baseline freeze.
4. `CH-06` — Graph quality gates.

Причина: это foundation-слой и их можно вести разными агентами с минимальным пересечением контекста.

## 3.2) Active Task Registry

| CH | Task | Status | Owner | Start (UTC) | End (UTC) | Commits | Artifacts | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CH-01 | CEFR coverage matrix contract | DONE | Team | 2026-02-17T20:54:09Z | 2026-02-17T20:54:09Z | `169ef5e` | `docs/CEFR_COVERAGE_MATRIX_CONTRACT.md`, `src/scripts/cefr_coverage_report.ts` | Coverage matrix, report script, tests added |
| CH-02 | Data model v2 | DONE | Team | 2026-02-17T20:54:34Z | 2026-02-17T20:54:34Z | `52212b0`, `c313e65` | `prisma/schema.prisma`, `prisma/migrations/20260217190535_data_model_v2_entities/migration.sql`, `prisma/seeds/ch02_data_model_v2_seed.sql` | Prisma entities + migration + seed + DB contract tests |
| CH-03 | Immutable event log + trace linkage | DONE | Agent_3 | 2026-02-17T22:12:43Z | 2026-02-17T22:46:52Z | `480b4b8`, `55fa4b4` | `prisma/migrations/20260217222300_ch03_autopilot_event_log_trace/migration.sql`, `src/lib/autopilot/eventLog.ts`, `src/scripts/export_replay_event_log.ts`, `src/lib/gse/evidence.ts` | Append-only journal + end-to-end trace wiring + replay export |
| CH-04 | Policy decision log v2 contract | IN_PROGRESS | Agent_3 | 2026-02-18T00:44:50Z |  |  |  | Added as missing critical-path foundation task (CH-01..CH-06 block) |
| CH-05 | KPI contract + baseline freeze | DONE | Agent_1 | 2026-02-17T22:08:08Z | 2026-02-17T22:37:18Z | `42190a2` | `docs/CH05_KPI_CONTRACT.md`, `docs/reports/CH05_KPI_BASELINE_REPORT.json`, `src/lib/kpi/autopilotDashboard.ts`, `src/app/api/quality/autopilot-kpi/route.ts`, `src/scripts/ch05_kpi_baseline_report.ts` | KPI v1 contract, dashboard endpoint, signed baseline freeze artifacts |
| CH-06 | Graph quality gates | DONE | Agent_2 | 2026-02-17T22:10:22Z | 2026-02-17T22:48:13Z | `42190a2`, `dc6f2d1` | `.github/workflows/graph-quality-gates.yml`, `docs/GRAPH_QUALITY_GATES.md`, `src/lib/contracts/gseGraphQuality.ts`, `src/scripts/gse_graph_quality_report.ts` | Release-blocking graph invariants + drift report contract + CI artifact |
| CH-07 | Causal taxonomy v1 + JSON contract | DONE | Agent_1 | 2026-02-17T22:57:40Z | 2026-02-17T23:08:19Z | `4d97c39`, `2101384` | `docs/CAUSAL_TAXONOMY_V1_CONTRACT.md`, `src/lib/db/types.ts`, `src/lib/db/types.test.ts` | Canonical taxonomy labels, strict v1 schema, and legacy payload adapter |
| CH-08 | Causal model inference in evaluation pipeline | DONE | Agent_2 | 2026-02-17T23:00:13Z | 2026-02-17T23:20:13Z | `4879ff0`, `b95a14f` | `src/lib/causal/inference.ts`, `src/worker/index.ts`, `src/app/api/attempts/[id]/route.ts`, `src/scripts/ch08_causal_calibration_report.ts`, `docs/reports/CH08_CAUSAL_CALIBRATION_REPORT.json` | Deterministic causal inference write-path + attempt API causal payload + calibration report artifact |
| CH-09 | Cause-attributed evidence write path | DONE | Agent_2 | 2026-02-17T23:29:33Z | 2026-02-18T00:15:30Z | `65f0e5a`, `d5bc41d` | `prisma/migrations/20260217233800_ch09_cause_attributed_evidence/migration.sql`, `src/lib/gse/evidence.ts`, `src/lib/gse/mastery.ts`, `src/scripts/ch09_cause_attribution_audit.ts`, `docs/reports/CH09_CAUSE_ATTRIBUTION_AUDIT_REPORT.json`, `docs/CH09_CAUSE_ATTRIBUTED_EVIDENCE.md` | Evidence/mastery causal attribution persisted end-to-end + audit artifact/script added |
| CH-10 | Ambiguity trigger logic | DONE | Agent_2 | 2026-02-18T00:21:26Z | 2026-02-18T01:35:46Z | `d2e43f5`, `5971d52` | `src/lib/causal/ambiguityTrigger.ts`, `src/lib/causal/ambiguityTrigger.test.ts`, `src/lib/gse/planner.ts`, `src/app/api/task/next/route.ts`, `src/app/api/planner/simulate/route.ts`, `docs/CH10_AMBIGUITY_TRIGGER_LOGIC.md` | Entropy/margin/action-instability trigger integrated into planner with causal snapshot gating and test matrix |
| CH-13 | OOD generator v1 (axis-tagged) | DONE | Agent_1 | 2026-02-17T23:13:27Z | 2026-02-17T23:39:01Z | `b4d2773`, `b218b85` | `src/lib/ood/generator.ts`, `src/app/api/task/next/route.ts`, `docs/CH13_OOD_GENERATOR_V1.md` | Deterministic OOD axis-tagged generation + OODTaskSpec persistence + API exposure |
| CH-14 | Difficulty anchor calibration layer | IN_PROGRESS | Agent_1 | 2026-02-18T00:56:49Z |  |  |  | Claimed as next transfer-track item after CH-13 completion (independent from CH-10 files) |

## 3.3) Decision Log

| Date (UTC) | CH | Decision |
| --- | --- | --- |
| 2026-02-17 | BOARD | Обновлены execution docs: реестр с `Start/End/Commits/Artifacts`, универсальный prompt v2, chat-log протокол для `AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md` |
| 2026-02-17 | BOARD | Процесс упрощён: одна ветка, отдельный файл задач, отдельный файл общения, обязательная запись в общение после каждого шага |
| 2026-02-17 | CH-01 | Интегрированы рабочие изменения из агентской ветки в `codex/autopilot-execution-plan` |
| 2026-02-17 | CH-02 | Интегрированы рабочие изменения из агентской ветки в `codex/autopilot-execution-plan` |
| 2026-02-17 | CH-03 | Для trace-linkage введены `AutopilotEventLog` (append-only на уровне БД через trigger `prevent_autopilot_event_log_mutation`) и `AutopilotDelayedOutcome`; события пишутся в planner/task/attempt/evidence runtime и экспортируются скриптом `src/scripts/export_replay_event_log.ts` |
| 2026-02-17 | CH-05 | Принят KPI contract `autopilot-kpi-v1` с подписываемым baseline freeze (SHA-256), API dashboard `/api/quality/autopilot-kpi` и baseline artifacts в `docs/reports/CH05_KPI_BASELINE_REPORT.{json,md}` |
| 2026-02-17 | CH-06 | Для release-блокировки добавлен versioned graph quality contract (deterministic snapshot для CI + `--db` режим для live проверки), включая drift edge report и workflow-артефакт |
| 2026-02-17 | CH-07 | Для causal taxonomy v1 зафиксированы канонические labels и strict JSON contract; добавлен backward-compat adapter для legacy полей (`topCause/topP/causes`) и legacy label aliases |
| 2026-02-17 | CH-08 | Causal inference в runtime сделан deterministic и без внешнего вызова модели: `CausalDiagnosis` upsert в worker для каждого completed attempt, выдача `results.causal` в `/api/attempts/[id]`, плюс calibration report script с агрегатами confidence/entropy/margin |
| 2026-02-18 | CH-09 | Cause-attributed write-path привязан к `CausalDiagnosis`: `AttemptGseEvidence` и `StudentGseMastery` сохраняют top cause/probability/distribution/modelVersion; добавлен audit script `src/scripts/ch09_cause_attribution_audit.ts` с отчётом покрытия/контрактных нарушений |
| 2026-02-18 | CH-10 | В planner добавлен ambiguity trigger по blueprint (`entropy > H_max` или `topMargin < M_min` + material action instability по utility gap): disambiguation probe включается только если реально меняет выбор действия; trigger trace пишется в `utilityJson` и отдаётся в planning API |
| 2026-02-17 | CH-13 | OOD generator v1 добавлен в `task/next`: deterministic cadence, axis tags по task family, запись `OODTaskSpec` на каждую OOD-инъекцию и additive `oodTaskSpec` поле в API ответе |

## 4) Execution Board (обособленные изменения)

### A. Product Contract + Data Backbone

- [x] **CH-01 — CEFR coverage matrix contract**  
  Done: есть versioned матрица `descriptor -> node -> task family -> rubric row` + тест полноты (coverage gaps = release blocker).  
  Артефакт: новый endpoint/отчёт coverage + CI check.

- [x] **CH-02 — Data model v2 (core blueprint entities)**  
  Done: добавлены сущности для `CausalDiagnosis`, `LearnerTwinSnapshot`, `OODTaskSpec`, `SelfRepairCycle`, `ReviewQueueItem`, `RewardTrace`, `AnchorEvalRun`.  
  Артефакт: Prisma migration + seed + schema tests.

- [x] **CH-03 — Immutable event log + trace linkage**  
  Done: сквозной trace (`decisionId -> taskId -> attemptId -> evidenceId -> delayedOutcomeId`) пишется в append-only журнал.  
  Артефакт: replay-ready event export script.

- [ ] **CH-04 — Policy decision log v2 contract**  
  Done: лог содержит `policyVersion`, `contextSnapshotId`, `candidateActionSet`, `preActionScores`, `propensity`, `activeConstraints`, linkage fields.  
  Артефакт: schema validator + %invalid logs dashboard.

- [x] **CH-05 — KPI contract + baseline freeze**  
  Done: зафиксирован baseline по `mastery gain/hour`, `verified growth`, `7/30/90 retention`, `OOD pass`, `frustration proxy`, `latency`.  
  Артефакт: dashboard + signed baseline report.

- [x] **CH-06 — Graph quality gates**  
  Done: автоматические проверки графа (`acyclic prereqs`, `edge type validity`, `no orphan critical nodes`) блокируют релиз при падении.  
  Артефакт: CI job + отчёт о drift edges.

### B. Causal Intelligence

- [x] **CH-07 — Causal taxonomy v1 + JSON contract**  
  Done: введён единый словарь причин (`rule_confusion`, `l1_interference`, `retrieval_failure`, `instruction_misread`, `attention_loss`, `production_constraint`, `mixed`, `unknown`).  
  Артефакт: typed schema + backward compatibility adapter.

- [x] **CH-08 — Causal model inference in evaluation pipeline**  
  Done: каждый валидный attempt получает распределение причин + confidence interval, не только pass/fail.  
  Артефакт: causal output в attempt API + calibration report.

- [x] **CH-09 — Cause-attributed evidence write path**  
  Done: evidence и mastery хранят top cause + distribution + model version.  
  Артефакт: DB fields + audit query scripts.

- [x] **CH-10 — Ambiguity trigger logic**  
  Done: реализованы правила `entropy/margin/action-instability` для запуска disambiguation probes только когда это меняет решение.  
  Артефакт: unit/integration tests на trigger matrix.

- [ ] **CH-11 — Disambiguation probe task family**  
  Done: добавлены micro-task templates для разведения конкурирующих причин, с budget caps per session/skill.  
  Артефакт: generator tests + budget guard metrics.

- [ ] **CH-12 — Cause-driven remediation policy rules**  
  Done: policy выбирает разные стратегии по cause class, а не общий retry/weakness path.  
  Артефакт: decision trace показывает влияние cause на action choice.

### C. Transfer/OOD Control

- [x] **CH-13 — OOD generator v1 (axis-tagged)**  
  Done: OOD задачи генерируются с явными осями shift (`topic/register/interlocutor/goal/format`).  
  Артефакт: `OODTaskSpec` rows + API exposure.

- [ ] **CH-14 — Difficulty anchor calibration layer**  
  Done: введены anchor sets и общая шкала сложности между task families.  
  Артефакт: periodic calibration job + anchor stability report.

- [ ] **CH-15 — Difficulty matching protocol**  
  Done: transfer fail валиден только при pass на matched in-domain control в том же окне.  
  Артефакт: transfer verdict audit endpoint.

- [ ] **CH-16 — Policy OOD budget controller**  
  Done: OOD инъекции идут по бюджету (база 10-20%, повышается у milestone/overfit cases).  
  Артефакт: per-learner OOD budget telemetry.

- [ ] **CH-17 — Milestone multi-axis stress gates**  
  Done: промоушен milestone требует pass multi-axis stress set (worst-case floor, не среднее).  
  Артефакт: promotion audit содержит stress gate details.

- [ ] **CH-18 — Transfer remediation queue**  
  Done: при OOD fail learner уходит в targeted remediation path и повторную transfer verification.  
  Артефакт: queue SLA dashboard + recovery rate metric.

### D. Learning Policy (Hybrid -> Learned)

- [ ] **CH-19 — Reward function v1 (versioned)**  
  Done: формализован reward = mastery delta + transfer + retention - friction, версия хранится в trace.  
  Артефакт: reward config registry + replay reproducibility test.

- [ ] **CH-20 — Offline replay dataset builder**  
  Done: строится обучающий набор `context -> action -> delayed outcome` из event log.  
  Артефакт: replay dataset job + completeness stats.

- [ ] **CH-21 — Off-policy evaluation pipeline**  
  Done: OPE считает lift и confidence bounds; incomplete logs автоматически исключаются.  
  Артефакт: OPE report в CI/CD promotion gate.

- [ ] **CH-22 — Learned value model in shadow mode**  
  Done: learned scorer работает в shadow рядом с rules, без влияния на learner flow.  
  Артефакт: shadow disagreement dashboard + safety counters.

- [ ] **CH-23 — Guardrailed hybrid selector**  
  Done: action выбирается через hard constraints + learned value + exploration floor; safety constraints непробиваемы.  
  Артефакт: decision trace с constraint mask и propensity.

- [ ] **CH-24 — Fast-lane progression protocol**  
  Done: high-confidence learners автоматически получают lower diagnostic/OOD density между milestone gates.  
  Артефакт: fast-lane cohort report (velocity vs safety).

### E. Self-Repair + Retention Engine

- [ ] **CH-25 — Mandatory immediate self-repair loop**  
  Done: после causal feedback запускается immediate corrected re-attempt (как часть normal flow).  
  Артефакт: `SelfRepairCycle` records + completion rate metric.

- [ ] **CH-26 — Delayed non-duplicate verification**  
  Done: delayed verification обязателен и проходит на другом task family/формулировке.  
  Артефакт: duplicate-check validator + invalid-verification counter.

- [ ] **CH-27 — Repair budget guardrails + escalation**  
  Done: лимиты immediate loops (<=2 per skill/session, <=25% session time) + auto escalation path при deadlock.  
  Артефакт: budget exhaustion telemetry.

- [ ] **CH-28 — Memory scheduler v1**  
  Done: node-level review queue с портфелем `fresh + review + transfer`, приоритет для fragile nodes.  
  Артефакт: queue latency and due-miss dashboard.

- [ ] **CH-29 — 7/30/90 retention checks**  
  Done: встроены delayed retention probes и их результаты участвуют в stage confidence.  
  Артефакт: retention cohort report by stage/domain.

- [ ] **CH-30 — Retention-aware promotion blockers**  
  Done: high-stakes promotion блокируется при провале retention gate даже при высоком immediate mastery.  
  Артефакт: promotion audit reason includes retention gate.

### F. Kenya Localization + Discourse C1/C2

- [ ] **CH-31 — Perception language-id + code-switch signals**  
  Done: Perception возвращает English/Swahili/Sheng/home-language tags с confidence.  
  Артефакт: tagged attempts telemetry + calibration sample report.

- [ ] **CH-32 — L1 interference priors and templates**  
  Done: политика использует interference priors по age/domain и подбирает targeted remediation templates.  
  Артефакт: cause-to-template mapping stats.

- [ ] **CH-33 — Locale adaptation in policy context**  
  Done: `LearnerTwinSnapshot` включает locale/L1 profile; decisions меняются наблюдаемо и explainably.  
  Артефакт: A/B report uplift for localized cohort.

- [ ] **CH-34 — Discourse/pragmatics engine v1**  
  Done: добавлены rubric dimensions для argument structure, register, turn-taking/repair, cohesion, audience fit.  
  Артефакт: evaluator outputs + adjudicated quality benchmark.

- [ ] **CH-35 — Advanced discourse task families**  
  Done: task generator умеет C1/C2 семьи задач для аргументации, register switching и misunderstanding repair.  
  Артефакт: task catalog diff + pass-rate by task family.

### G. Multi-Modal Expansion to Full C2 Claim

- [ ] **CH-36 — Reading runtime + assessment pipeline**  
  Done: отдельный task/eval/evidence контур для reading интегрирован в общий mastery graph.  
  Артефакт: reading attempts in production + quality metrics.

- [ ] **CH-37 — Writing runtime + assessment pipeline**  
  Done: writing контур с rubric/evidence/mastery updates и child UX для редакции/переписывания.  
  Артефакт: writing progression dashboard.

- [ ] **CH-38 — Listening runtime + assessment pipeline**  
  Done: listening задачи и оценка comprehension/repair behavior подключены к policy loop.  
  Артефакт: listening transfer/retention metrics.

- [ ] **CH-39 — Unified cross-modality placement and mastery**  
  Done: cold-start orchestrator покрывает speaking/listening/reading/writing + grammar/vocab, с bounded uncertainty stop criteria.  
  Артефакт: placement confidence report by domain.

### H. Governance + Safe Rollout

- [ ] **CH-40 — Model/prompt registry**  
  Done: все judge/generator/causal/policy модели и prompt versions регистрируются и трассируются в решениях.  
  Артефакт: registry UI/endpoint + immutable release tags.

- [ ] **CH-41 — Regression suites for blueprint invariants**  
  Done: регрессии на causal quality, transfer, retention, frustration, retry precision и invariants из blueprint.  
  Артефакт: invariant test pack in CI.

- [ ] **CH-42 — Shadow-mode + stop-loss rollout automation**  
  Done: новые policy versions проходят shadow, progressive ramp, auto rollback по стоп-лоссу.  
  Артефакт: rollout controller logs + rollback drills.

- [ ] **CH-43 — Parent/Teacher Copilot v2**  
  Done: интерфейс показывает blocker-causes, transfer/retention health, ETA to next milestone, decision traces (без шума).  
  Артефакт: updated teacher API + UI screens.

- [ ] **CH-44 — Operational playbooks automation**  
  Done: автоматизированы runbooks `retry loop`, `cause plateau`, `weak transfer despite high in-domain`, `fast progress low reliability`.  
  Артефакт: runbook triggers + incident outcomes report.

- [ ] **CH-45 — Latency/reliability SLO enforcement**  
  Done: бюджеты latency и reliability для критических модулей enforced; деградации переводят поток в deterministic fallback без потери инвариантов.  
  Артефакт: SLO dashboard + synthetic canary checks.

## 5) Финальный критерий "world-class readiness"

Режим world-class включается только когда выполнены одновременно:
- [ ] Все `CH-01..CH-45` закрыты.
- [ ] Политика проходит promotion gate (`offline replay + OPE + shadow + anchor-eval`).
- [ ] Milestone promotion в production реально опирается на `mastery + transfer + retention`.
- [ ] C2 claims подтверждены по 4 modality (speaking/listening/reading/writing) с CEFR coverage contract.

## 6) Универсальный промпт для запуска агента

Используй этот шаблон (замени только `OWNER_NAME`):

```text
Работаем в репозитории /Users/skyeng/Desktop/duma_english.

Ты автономный инженер. Цель: быстро и качественно двигать execution board к world-class продукту с сохранением инвариантов.

Обязательная ветка исполнения:
- codex/autopilot-execution-plan

Обязательный протокол:
1) Синхронизация:
   - git fetch origin
   - git checkout codex/autopilot-execution-plan
   - git pull --ff-only origin codex/autopilot-execution-plan
2) Zero-context onboarding (обязательно прочитать):
   - docs/AUTONOMOUS_ENGLISH_AUTOPILOT_BLUEPRINT.md
   - docs/AUTONOMOUS_ENGLISH_AUTOPILOT_GAP_CLOSURE_PLAN.md
   - README.md
   - TASKS.MD
   - docs/BRAIN_RUNTIME.md
   - docs/BRAIN_ROADMAP.md
   - docs/DEBUG_PLAYBOOK.md
3) Выбор задачи (долгий горизонт):
   - в Active Task Registry (rolling queue) выбери первую строку сверху вниз, где Status=TODO и Owner пустой.
   - если свободных строк нет, добавь новую строку для следующего CH по критическому пути (раздел 3), затем выбери её.
4) Захват задачи:
   - обнови выбранную строку: Status=IN_PROGRESS, Owner=OWNER_NAME, Start (UTC).
   - сделай отдельный commit только с этой правкой.
   - запушь изменение в origin/codex/autopilot-execution-plan.
5) Шаг исполнения:
   - перед каждым шагом читай docs/AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md.
   - после каждого шага добавляй новую строку в docs/AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md.
   - текст сообщения свободный; указывай Owner, CH, краткий контекст шага.
6) Реализация:
   - выполняй полный DoD выбранного CH.
   - пиши атомарные коммиты с понятными сообщениями.
7) Документация решений:
   - при дополнительных технических решениях добавляй запись в раздел 3.3 Decision Log.
8) Проверки качества:
   - прогоняй релевантные тесты/линтер/сборку для изменённых частей.
   - фиксируй фактические результаты проверок (что запускалось и итог каждого запуска).
9) Завершение задачи:
   - обнови строку задачи: Status=DONE, End (UTC), Commit, Artifacts.
   - обнови чекбокс соответствующего CH в основном execution board.
   - добавь короткую HANDOFF/INFO запись в AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md.
   - запушь изменения в origin/codex/autopilot-execution-plan.
10) Следующий цикл:
   - снова синхронизируй ветку.
   - переходи к выбору следующего CH.

Требование к результату:
- полноценная реализация DoD для выбранного CH из плана;
- production-grade качество;
- сохранение инвариантов blueprint;
- документирование всех экстра-решений через Decision Log.
```
