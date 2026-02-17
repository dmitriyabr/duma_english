# Autonomous English Autopilot: Gap Closure Execution Board

Last updated: 2026-02-17
Source baseline: `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_BLUEPRINT.md` + current code/docs (`README.md`, `TASKS.MD`, `docs/BRAIN_RUNTIME.md`)

## 0) Multi-Agent Operating Protocol (обязательно)

Этот файл — единый coordination board для всех агентов. Любая работа начинается и заканчивается обновлением этого файла.

Execution branch (обязательно):
- Координационная ветка плана: `codex/autopilot-execution-plan`.
- Работать в `main` запрещено.
- Любая агентская задача стартует с актуализации этой ветки и lock-коммита именно в неё.
- Реализация ведётся в отдельной ветке агента, созданной от `codex/autopilot-execution-plan`.

Zero-context onboarding (прочитать перед выбором задачи):
1. `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_BLUEPRINT.md` (target product contract).
2. `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_GAP_CLOSURE_PLAN.md` (execution board и протокол).
3. `README.md` (runtime/how-to-run).
4. `TASKS.MD` (текущая runtime truth и текущие gaps).
5. `docs/BRAIN_RUNTIME.md` и `docs/BRAIN_ROADMAP.md` (brain architecture/status).
6. `docs/DEBUG_PLAYBOOK.md` (операционные детали текущей системы).

Межагентная коммуникация:
- Файл: `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md`.
- Используется для handoff/blocker/risk сообщений между агентами (append-only, новые строки в конец).

Статусы задач:
- `TODO`: задача свободна, к исполнению не взята.
- `IN_PROGRESS`: задача захвачена конкретным агентом, работа идёт.
- `DONE`: задача закрыта, артефакты и проверки заполнены.
- `BLOCKED`: задача остановлена, указана причина и точка блокировки.

Правило переходов (жёстко):
1. Перед любыми код-изменениями агент обновляет строку задачи в `Active Task Registry`: `Status=IN_PROGRESS`, заполняет `Owner`, `Branch`, `Start (UTC)`, `Scope lock`.
2. Агент работает только в пределах `Scope lock`. Выход за scope разрешён только после записи в `Decision Log` с причиной.
3. После завершения конкретной задачи агент сразу (в этом же PR/коммите) ставит `Status=DONE`, заполняет `End (UTC)`, `PR/Commit`, `Artifacts`, `Decision IDs`.
4. Закрывать задачи батчем запрещено: статус обновляется по каждой задаче отдельно.
5. Если задача блокирована, агент ставит `BLOCKED` и фиксирует unblock condition.

Правило изоляции:
1. Один агент = одна задача `CH-XX` одновременно.
2. Нельзя менять строки чужих активных задач, кроме явного handoff с записью в `Decision Log`.
3. Ветка задачи: `codex/ch-XX-short-name`.
4. Для минимизации merge-конфликтов агент редактирует только свою строку в реестре и только новые строки в `Decision Log`.

Правило выбора задачи (универсальное):
1. Агент не получает `CH-XX` извне, а сам выбирает первую доступную задачу в `Active Task Registry` сверху вниз.
2. Доступная задача = `Status=TODO` и пустой `Owner`.
3. Если доступных задач нет, агент не начинает код, а пишет "no free tasks" и завершает сессию.

Task lock handshake (обязательно перед кодом):
1. Синхронизировать `origin/codex/autopilot-execution-plan`.
2. В реестре у выбранной задачи поставить `Status=IN_PROGRESS`, `Owner`, `Start (UTC)`, `Branch`.
3. Сделать отдельный lock-коммит только с изменением реестра и запушить в `origin/codex/autopilot-execution-plan`.
4. Только после успешного lock-пуша создать рабочую ветку от `codex/autopilot-execution-plan` и начинать реализацию.
5. Если lock-пуш не прошёл (non-fast-forward), повторить синхронизацию и заново выбрать первую доступную задачу.

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

## 3.1) Первая волна задач (параллельно и изолированно)

Первыми запускаем:
1. `CH-01` — CEFR coverage matrix contract.
2. `CH-02` — Data model v2.
3. `CH-05` — KPI contract + baseline freeze.
4. `CH-06` — Graph quality gates.

Причина: это foundation-слой и их можно вести разными агентами с минимальным пересечением контекста.

## 3.2) Active Task Registry (Wave 1)

| CH | Task | Status | Owner | Branch | Scope lock | Start (UTC) | End (UTC) | PR/Commit | Artifacts | Decision IDs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CH-01 | CEFR coverage matrix contract | TODO |  | `codex/ch-01-cefr-coverage` | `docs/**`, `src/lib/contracts/**`, `src/scripts/**` (без `prisma/**`) |  |  |  |  |  |
| CH-02 | Data model v2 | TODO |  | `codex/ch-02-data-model-v2` | `prisma/**`, `src/lib/db/**`, `src/lib/**/types*` |  |  |  |  |  |
| CH-05 | KPI contract + baseline freeze | TODO |  | `codex/ch-05-kpi-baseline` | `docs/**`, `src/scripts/**`, `src/lib/gse/quality*`, `.github/workflows/**` |  |  |  |  |  |
| CH-06 | Graph quality gates | TODO |  | `codex/ch-06-graph-gates` | `src/lib/gse/**`, `src/scripts/**`, `.github/workflows/**`, `docs/**` (без `prisma/**`) |  |  |  |  |  |

## 3.3) Decision Log (append-only)

Записывать только решения/экстра-меры, которых не было в исходном плане.

| Decision ID | Date (UTC) | CH | Owner | Decision | Why | Impacted paths | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DEC-2026-02-17-001 | 2026-02-17T00:00:00Z | BOARD | system | Введён Active Task Registry + Scope lock + append-only Decision Log | Нужно безопасно запустить параллельную работу агентов без конфликтов | `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_GAP_CLOSURE_PLAN.md` | Все агенты обязаны обновлять статусы и решения в этом файле |
| DEC-2026-02-17-002 | 2026-02-17T00:00:00Z | BOARD | system | Выбор задачи сделан универсальным (первая доступная), добавлен lock handshake через отдельный push | Чтобы агентам не назначали CH вручную и чтобы избежать double-claim одной задачи | `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_GAP_CLOSURE_PLAN.md` | Все агенты стартуют только через lock-коммит |
| DEC-2026-02-17-003 | 2026-02-17T00:00:00Z | BOARD | system | Execution branch зафиксирована как `codex/autopilot-execution-plan`; добавлены zero-context onboarding и общий файл связи агентов | Нужны автономный запуск агентов с нулевым контекстом и рабочая коммуникация без чатов | `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_GAP_CLOSURE_PLAN.md`, `docs/AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md` | Все агенты работают только через execution branch и пишут handoff/blockers в sync-файл |

## 4) Execution Board (обособленные изменения)

### A. Product Contract + Data Backbone

- [ ] **CH-01 — CEFR coverage matrix contract**  
  Done: есть versioned матрица `descriptor -> node -> task family -> rubric row` + тест полноты (coverage gaps = release blocker).  
  Артефакт: новый endpoint/отчёт coverage + CI check.

- [ ] **CH-02 — Data model v2 (core blueprint entities)**  
  Done: добавлены сущности для `CausalDiagnosis`, `LearnerTwinSnapshot`, `OODTaskSpec`, `SelfRepairCycle`, `ReviewQueueItem`, `RewardTrace`, `AnchorEvalRun`.  
  Артефакт: Prisma migration + seed + schema tests.

- [ ] **CH-03 — Immutable event log + trace linkage**  
  Done: сквозной trace (`decisionId -> taskId -> attemptId -> evidenceId -> delayedOutcomeId`) пишется в append-only журнал.  
  Артефакт: replay-ready event export script.

- [ ] **CH-04 — Policy decision log v2 contract**  
  Done: лог содержит `policyVersion`, `contextSnapshotId`, `candidateActionSet`, `preActionScores`, `propensity`, `activeConstraints`, linkage fields.  
  Артефакт: schema validator + %invalid logs dashboard.

- [ ] **CH-05 — KPI contract + baseline freeze**  
  Done: зафиксирован baseline по `mastery gain/hour`, `verified growth`, `7/30/90 retention`, `OOD pass`, `frustration proxy`, `latency`.  
  Артефакт: dashboard + signed baseline report.

- [ ] **CH-06 — Graph quality gates**  
  Done: автоматические проверки графа (`acyclic prereqs`, `edge type validity`, `no orphan critical nodes`) блокируют релиз при падении.  
  Артефакт: CI job + отчёт о drift edges.

### B. Causal Intelligence

- [ ] **CH-07 — Causal taxonomy v1 + JSON contract**  
  Done: введён единый словарь причин (`rule_confusion`, `l1_interference`, `retrieval_failure`, `instruction_misread`, `attention_loss`, `production_constraint`, `mixed`, `unknown`).  
  Артефакт: typed schema + backward compatibility adapter.

- [ ] **CH-08 — Causal model inference in evaluation pipeline**  
  Done: каждый валидный attempt получает распределение причин + confidence interval, не только pass/fail.  
  Артефакт: causal output в attempt API + calibration report.

- [ ] **CH-09 — Cause-attributed evidence write path**  
  Done: evidence и mastery хранят top cause + distribution + model version.  
  Артефакт: DB fields + audit query scripts.

- [ ] **CH-10 — Ambiguity trigger logic**  
  Done: реализованы правила `entropy/margin/action-instability` для запуска disambiguation probes только когда это меняет решение.  
  Артефакт: unit/integration tests на trigger matrix.

- [ ] **CH-11 — Disambiguation probe task family**  
  Done: добавлены micro-task templates для разведения конкурирующих причин, с budget caps per session/skill.  
  Артефакт: generator tests + budget guard metrics.

- [ ] **CH-12 — Cause-driven remediation policy rules**  
  Done: policy выбирает разные стратегии по cause class, а не общий retry/weakness path.  
  Артефакт: decision trace показывает влияние cause на action choice.

### C. Transfer/OOD Control

- [ ] **CH-13 — OOD generator v1 (axis-tagged)**  
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

Ты автономный инженер. Цель: быстро и качественно двигать execution board к world-class продукту без деградации инвариантов.

Обязательная ветка исполнения:
- coordination branch: codex/autopilot-execution-plan
- работать в main запрещено.

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
3) Выбор задачи:
   - в Active Task Registry (Wave 1) выбери первую строку сверху вниз, где Status=TODO и Owner пустой.
   - если доступной задачи нет: запиши в ответ "no free tasks" и остановись.
4) Захват задачи (lock):
   - обнови выбранную строку: Status=IN_PROGRESS, Owner=OWNER_NAME, Start (UTC), Branch, Scope lock.
   - сделай отдельный lock-коммит только с этой правкой.
   - запушь lock-коммит в origin/codex/autopilot-execution-plan.
   - если push не прошёл (non-fast-forward), повтори синхронизацию и заново выбери первую доступную задачу.
5) Рабочая ветка:
   - создай отдельную ветку от codex/autopilot-execution-plan: codex/ch-xx-short-name-owner_name
   - всю реализацию веди в этой ветке.
6) Реализация:
   - выполняй полный DoD выбранного CH.
   - изменения только в Scope lock; выход за Scope lock только после новой записи в Decision Log (append-only).
   - пиши атомарные коммиты с понятными сообщениями.
7) Проверки качества:
   - прогоняй релевантные тесты/линтер/сборку для изменённых частей.
   - фиксируй фактические результаты проверок (что запускалось и что прошло/не прошло).
8) Межагентная связь:
   - используй docs/AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md
   - append-only записи типов INFO/BLOCKER/RISK/HANDOFF/DECISION_REF.
9) Завершение задачи:
   - обнови строку задачи: Status=DONE, End (UTC), PR/Commit, Artifacts, Decision IDs.
   - обнови чекбокс соответствующего CH в основном execution board.
   - если были экстра-решения, добавь их в Decision Log.
   - добавь короткую HANDOFF/INFO запись в AUTONOMOUS_ENGLISH_AUTOPILOT_AGENT_SYNC.md.
   - запушь рабочую ветку и подготовь PR в codex/autopilot-execution-plan.
10) Запрещено:
   - закрывать несколько CH одним статусом;
   - коммитить в main;
   - пропускать lock-коммит и документацию решений.

Требование к результату:
- полноценная реализация DoD для выбранного CH из плана;
- production-grade качество (не MVP-черновик);
- без поломки инвариантов;
- с документированием всех экстра-решений через Decision Log.
```
