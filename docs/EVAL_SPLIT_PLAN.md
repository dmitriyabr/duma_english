# План: раздельная оценка LO / Grammar / Vocab через LLM

Ветка: `feature/eval-split-lo-grammar-vocab`

## Цель

Улучшить качество и полноту обработки ответа ученика (транскрипт) за счёт:

1. **Разделения одного большого запроса** на три отдельных: отдельно на LO, отдельно на Grammar, отдельно на Vocab.
2. **Расширения лимитов** в каждом запросе: передавать и получать больше нод (не случайно — за счёт больших лимитов и отдельного контекста на домен).
3. **Сборки единого ответа** из трёх частей и записи в навыки тем же путём, что и сейчас (без изменения контракта evidence/mastery).

---

## Текущее состояние

- Один вызов `evaluateWithOpenAI`: один промпт, один JSON-ответ.
- В промпт попадают:
  - Target LO (≤4), Candidate LO (≤6) → в ответе **at most 4 loChecks**.
  - Target Grammar (≤6), Candidate Grammar (≤8) → **at most 6 grammarChecks**.
  - Target Vocab (≤8), Candidate Vocab (≤10 инцидентальных) → **at most 8 vocabChecks**.
- Плюс в том же ответе: taskScore, languageScore, rubricChecks, artifacts, evidence, feedback.
- Ограничение **maxTokens: 1100** на весь ответ — из-за этого модель часто возвращает меньше чеков, чем лимит.

Итого: один «общий» контекст, жёсткие лимиты и один токен-лимит на всё — получаем мало LO/grammar/vocab чеков и зависимость качества от урезания ответа.

---

## Предлагаемая схема

### 1. Три отдельных запроса к LLM

| Запрос | Вход | Выход | Лимиты (предложение) |
|--------|------|--------|----------------------|
| **LO** | Транскрипт, task type, task prompt, **Target LO** (все таргеты), **Candidate LO** (расширенный список) | Только **loChecks** (и опционально короткий evidence list для LO) | Target: все таргеты LO. Candidates: напр. до 16. В ответ: до 8 loChecks. |
| **Grammar** | Транскрипт, task type, **Target Grammar**, **Candidate Grammar** (расширенный) | Только **grammarChecks** | Target: все. Candidates: напр. до 14. В ответ: до 10 grammarChecks. |
| **Vocab** | Транскрипт, task type, **Target Vocab**, **Candidate Vocab** (расширенный) | Только **vocabChecks** | Target: все. Candidates: напр. до 20. В ответ: до 12 vocabChecks. |

Каждый запрос — отдельный промпт с чёткой ролью («оцени только LO / только grammar / только vocab»), без рубрик, артефактов и feedback в этом ответе. Токен-лимит на ответ можно задать отдельно под размер ожидаемого списка (например, 600–800 на домен).

### 2. Расширение лимитов

- **Retrieval** (уже до среза в evaluator): не резать так агрессивно перед отправкой в LLM.
  - В коде сейчас: `loOptions.slice(0, 6)`, `grammarOptions.slice(0, 8)`, `vocabOptions.slice(0, 10)`.
  - Для split-режима: увеличить до 16 / 14 / 20 (или вынести в конфиг/константы).
- **Ответ модели**: в промпте каждого из трёх запросов явно указать новые лимиты (8 LO, 10 grammar, 12 vocab) и требование не быть минималистичным при наличии доказательств.

Цель — не «больше случайных нод», а «больше релевантных» за счёт отдельного контекста и снятия конкуренции с рубриками/feedback в одном ответе.

### 3. Общая оценка задачи и обратная связь (один запрос или правило)

- **taskScore, languageScore, rubricChecks, artifacts, feedback** — сейчас в одном ответе с чеками.
- Варианты:
  - **A)** Оставить один «лёгкий» запрос только на общую оценку + рубрики + feedback (без LO/grammar/vocab), после того как три доменных запроса уже выполнены; в него можно передать суммарную информацию по чекам (например, «LO: 2 pass, grammar: 2 pass, vocab: 3 pass») для согласованности.
  - **B)** Считать taskScore/languageScore по правилам из уже полученных loChecks/grammarChecks/vocabChecks + speech metrics, без второго LLM; feedback генерировать одним отдельным маленьким запросом по итогам.

На первом шаге достаточно зафиксировать выбор (A или B) и описать в плане.

### 4. Сборка ответа и запись в навыки

- Из трёх ответов собрать один объект в формате текущего **taskEvaluationJson**:
  - `loChecks` — из ответа LO-запроса.
  - `grammarChecks` — из ответа Grammar-запроса.
  - `vocabChecks` — из ответа Vocab-запроса.
  - `taskScore`, `languageScore`, `rubricChecks`, `artifacts`, `evidence`, `modelVersion` — из общего запроса или из правил (согласно п. 3).
  - `feedback` — как сейчас (из общего запроса или отдельного).
- **Ниже по пайплайну ничего не менять**: `buildOpportunityEvidence` и запись в БД (AttemptGseEvidence, обновление mastery) принимают тот же `taskEvaluationJson` и тот же контракт. Изменения только в способе получения этого JSON (три запроса + merge вместо одного).

---

## Шаги реализации (черновик)

1. **Конфиг/флаги**  
   Ввести флаг (env или конфиг), например `EVAL_SPLIT_BY_DOMAIN=true`, под которым включается новая схема (три запроса + merge). При `false` — текущее поведение (один запрос).

2. **Retrieval**  
   В evaluator при split-режиме не применять жёсткие slice(0, 6/8/10); использовать увеличенные лимиты (16/14/20) для lo/grammar/vocab кандидатов. Общие вызовы `buildSemanticEvaluationContext` и `buildVocabEvaluationContext` оставить как есть; менять только объём данных, передаваемых в промпт.

3. **Три промпта и три вызова LLM**  
   - Функции (или один модуль): `evaluateLoOnly(...)`, `evaluateGrammarOnly(...)`, `evaluateVocabOnly(...)`.  
   - Каждая принимает transcript, task type/prompt, соответствующие target/candidate options, возвращает только массив чеков (и при необходимости минимальный evidence).  
   - Схемы ответа (zod) — только нужные поля (loChecks / grammarChecks / vocabChecks).

4. **Общая оценка и feedback**  
   Реализовать выбранный вариант (A или B): один запрос на score + rubric + feedback или расчёт по правилам + один запрос на feedback.

5. **Merge**  
   Функция `mergeSplitEvaluationResults(loResult, grammarResult, vocabResult, generalResult)` → один объект типа `TaskEvaluation` + feedback. Проверка: структура совместима с текущим `taskEvaluationJson` и с `buildOpportunityEvidence`.

6. **Интеграция в evaluateTaskQuality**  
   При `EVAL_SPLIT_BY_DOMAIN=true`:  
   - параллельно вызвать три доменных запроса;  
   - получить общую оценку (и при необходимости feedback);  
   - собрать merge;  
   - дальше как сейчас (attachStructuredChecks, нормализация feedback, возврат).  
   При `false` — текущий путь (один `evaluateWithOpenAI`).

7. **Лимиты и промпты**  
   Вынести лимиты (сколько кандидатов отправлять, сколько чеков разрешать в ответе) в константы или env; в каждом из трёх промптов явно указать эти лимиты и правило «не быть минималистичным при наличии доказательств».

8. **Тесты и откат**  
   - Тесты: на merge (формат, все поля на месте); опционально — интеграционный тест с моком LLM для split-режима.  
   - Откат: выключение флага возвращает к одному запросу без изменения контракта.

---

## Критерии успеха

- При включённом split-режиме и тех же данных retrieval в ответе стабильно больше loChecks, grammarChecks и vocabChecks (в пределах новых лимитов), без падения качества (проверка по золотому набору или по инспекции последней попытки).
- Формат `taskEvaluationJson` и поведение evidence/mastery не меняются; меняется только способ получения чеков.
- Возможность отключить новую схему одним флагом без правок кода evidence/mastery.

---

## Открытые вопросы

- Точные числа лимитов (16/14/20 для кандидатов, 8/10/12 для чеков) — подобрать по результатам прогонов и размеру ответа.
- Вариант A vs B для taskScore/rubric/feedback — решить до реализации общего запроса/правил.
- Нужно ли в общий (или в каждый доменный) промпт передавать результаты других доменов для согласованности (например, «vocab: 3/3 target used») — опционально.

---

## Реализовано (2026-02-08)

- Флаг `EVAL_SPLIT_BY_DOMAIN` (env). При `true`: вызываются `evaluateWithOpenAISplit` вместо `evaluateWithOpenAI`.
- Константы: LO 16 кандидатов / 8 чеков, Grammar 14/10, Vocab 20/12.
- Три доменных вызова: `evaluateLoOnly`, `evaluateGrammarOnly`, `evaluateVocabOnly` — каждый со своим промптом и схемой (zod), параллельно через `Promise.all`.
- Общий вызов: `evaluateGeneralOnly` — taskScore, languageScore, rubricChecks, artifacts, evidence, feedback; в промпт передаётся domainSummary (loPass, grammarPass, vocabPass).
- Сборка: один `TaskEvaluation` из general + loChecks/grammarChecks/vocabChecks; возврат в том же формате, что и однозапросный путь; `attachStructuredChecks` и запись в навыки без изменений.
- `.env.example`: закомментированная строка `# EVAL_SPLIT_BY_DOMAIN=true`.
