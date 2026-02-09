# Разбор последней попытки по шагам

Данные взяты из БД и `tmp/pipeline-debug.ndjson` (скрипт: `npx tsx src/scripts/inspect_last_attempt_factual.ts`).

---

## Исходные данные попытки

| Поле | Значение |
|------|----------|
| **Attempt id** | cmldyye3s000h5xz4oozyinuv |
| **Task id** | cmldyx2gl000a5xz4qrzt6ktj |
| **Task type** | qa_prompt |
| **Student** | Testov |
| **Completed** | 2026-02-08T16:40:52.154Z |
| **Task score** | 100 |

**Транскрипт (из БД):**  
*"Yesterday I had a deep conversation with my teacher, so I asked him a question about how did universe started. And he told me about Big Bang Theory and that it was a long time ago and physicists all over the world still trying to understand well, what's what is actually what's happened that time. So why I ask this question is because I'm really interesting of history of things. It's very important to me to understand how this world worked. And how to live in it."*

---

## Шаг 1. Worker подхватывает попытку

- Статус попытки: `uploaded` → `processing`.
- Из БД читаются: **Attempt** (audioObjectKey, taskId, studentId), **Task** (type, prompt, metaJson).
- Аудио скачивается из S3/MinIO в буфер.

---

## Шаг 2. Речь → транскрипт и метрики

- **Куда:** `analyzeSpeechFromBuffer(audioBuffer, { taskPrompt, taskType, durationSec, meta })`.
- **Откуда:** провайдер речи (Azure или mock).
- **Результат:**  
  - `analysis.transcript` — сохранённый в БД текст выше.  
  - `analysis.metrics` → потом `calculateDerivedSpeechMetrics` → speechRate, fillerCount и т.д.

Эти данные дальше уходят в оценку и в БД (transcript, speechMetricsJson).

---

## Шаг 3. Таргеты задания (вход в оценку)

- **Откуда:** БД, `TaskGseTarget` по `taskId`, с подгрузкой `node` (nodeId, type, sourceKey, descriptor).
- **Что передаётся в evaluator:** массив `taskTargets` — каждый элемент: nodeId, weight, required, node: { nodeId, type, sourceKey, descriptor }.

**По последней попытке в БД было:**

| type       | nodeId (коротко) | descriptor |
|-----------|-------------------|------------|
| GSE_VOCAB | …12c6             | "ask"      |
| GSE_GRAMMAR | 55af7503d6c1560c41c6a3bf | Can tell when to use the past simple and when to use the present perfect (BrE). |
| GSE_GRAMMAR | 56f3d7b24d2694ed0dc5e024 | Can form compound nouns from nouns plus other nouns and adjectives. |

Таргеты без изменений передаются в **evaluateTaskQuality** и используются как Target LO / Target Grammar / Target Vocabulary в промптах и при сборке evidence.

---

## Шаг 4. Парсер (LO intents + grammar patterns)

- **Где:** внутри `buildSemanticEvaluationContext` (semanticAssessor): по транскрипту и типу задания вызывается LLM-парсер.
- **Куда пишется:** в pipeline-debug — событие `semantic_retrieval_queries`.

**Что попало в retrieval по последней попытке:**

- **LO intents:**  
  "Ask a question for clarification", "Express interest in a topic", "Explain reasons for asking", "Describe the importance of understanding"
- **Grammar patterns:**  
  "Past simple affirmative", "Past simple (ask)", "Past simple (tell)", "Present continuous (trying)", "Present simple (be)" (×2), "Because clause for reasons", "How clause for explanation"

Эти строки используются как запросы к эмбеддингам (LO и Grammar) на следующем шаге.

---

## Шаг 5. Retrieval: кандидаты LO, Grammar, Vocab

Вызовы идут из **evaluateWithOpenAISplit**: параллельно `buildSemanticEvaluationContext` и `buildVocabEvaluationContext`.

### 5.1 LO и Grammar (semantic)

- **Вход:** транскрипт, task type, stage (из taskMeta или A2), ageBand; запросы — LO intents и grammar patterns из парсера.
- **Что делается:** эмбеддинги запросов, поиск по `GseNodeEmbedding` (cosine) в окне stage/audience, сортировка по score.
- **В лог:** `semantic_retrieval_candidates` — списки `loCandidates` и `grammarCandidates` (в скрипте выведены топ-12 по каждому).
- **В evaluator:** из этих списков отфильтровываются таргеты, затем берутся срезы по лимитам split-режима (LO 16, Grammar 14) и формируются **Candidate LO options** и **Candidate Grammar options** для промптов.

### 5.2 Vocab

- **Вход:** транскрипт, stage, ageBand, taskType, runId (taskId).
- **Что делается:** лемматизация, n-граммы, поиск по индексу дескрипторов/алиасов GSE_VOCAB в окне stage → список кандидатов с retrievalScore и matchedPhrases.
- **В лог:** `vocab_retrieval_phrase_candidates` (фразы из транскрипта), `vocab_retrieval_candidates` (топ кандидатов, у последней попытки 23 кандидата).
- **В evaluator:** из кандидатов убираются таргеты, срез по лимиту (20) → **Candidate Vocabulary options** для промпта.

Итого: в LLM по доменам передаются **Target** (из шага 3) и **Candidate** (из retrieval после фильтра и среза).

---

## Шаг 6. Evaluator (split: 4 запроса к LLM)

Один вызов **evaluateTaskQuality** → внутри **evaluateWithOpenAISplit**.

### 6.1 Три доменных запроса (параллельно)

- **evaluateLoOnly**  
  - Вход: transcript, task type/prompt, **Target LO options**, **Candidate LO options** (до 16).  
  - Выход: массив **loChecks** (до 8), каждый с checkId (ожидается nodeId), label, pass, confidence, severity, evidenceSpan.

- **evaluateGrammarOnly**  
  - Вход: transcript, **Target Grammar options**, **Candidate Grammar options** (до 14), множество target descriptorId.  
  - Выход: массив **grammarChecks** (до 10), с descriptorId, pass, confidence, opportunityType и т.д.

- **evaluateVocabOnly**  
  - Вход: transcript, **Target Vocab options**, **Candidate Vocab options** (до 20), множество target nodeId.  
  - Выход: массив **vocabChecks** (до 12), с nodeId, pass, confidence, opportunityType и т.д.

### 6.2 Общий запрос (general)

- **evaluateGeneralOnly**  
  - Вход: transcript, task type/prompt, плюс **domainSummary** (числа: loPass, grammarPass, vocabPass из трёх доменных ответов).  
  - Выход: taskScore, languageScore, rubricChecks, artifacts, evidence (цитаты), feedback (summary, whatWentWell, whatToFixNow, exampleBetterAnswer, nextMicroTask).

### 6.3 Сборка результата

- **taskEvaluation** собирается из:  
  - general: taskScore, languageScore, rubricChecks, artifacts, evidence, modelVersion;  
  - доменные: loChecks, grammarChecks, vocabChecks.  
- Дальше вызывается **attachStructuredChecks** (подмешивает/нормализует lo/grammar/vocab из ответа модели).  
- Возвращаются **taskEvaluation** и **feedback**; worker пишет их в БД в `taskEvaluationJson` и `feedbackJson`.

**По последней попытке в БД оказалось:**

- **loChecks:** 3 штуки с checkId `question_answered`, `direct_answer_first`, `supporting_reasons` — это не GSE nodeId (не формата gse:...), то есть модель LO вернула рубрикоподобные метки вместо ID из опций.
- **grammarChecks:** пусто.
- **vocabChecks:** пусто.
- **taskScore:** 100, значит general-запрос отработал.

Итого: доменные запросы либо вернули не те форматы/пустые списки, либо парсинг их отрезал; в итоге в evidence используются правила и fallback (см. шаг 7).

---

## Шаг 7. Запись в БД и evidence

### 7.1 Что worker пишет в Attempt

- **transcript**, **speechMetricsJson**, **rawRecognitionJson**
- **taskEvaluationJson** — весь собранный taskEvaluation (в т.ч. loChecks, grammarChecks, vocabChecks как выше)
- **feedbackJson**
- **scoresJson** (composeScores от taskScore, languageScore, метрик, reliability)
- **status: "completed"**, **completedAt**

### 7.2 Evidence (persistAttemptGseEvidence)

- **Вход:** attemptId, studentId, taskId, taskType, taskPrompt, taskMeta, transcript, derivedMetrics, **taskEvaluation** (из шага 6), scoreReliability, ageBand.
- **Откуда логика:** `src/lib/gse/evidence.ts` — по полям taskEvaluation (loChecks, grammarChecks, vocabChecks) и таргетам строятся черновики evidence (signalType, evidenceKind, opportunityType, score, confidence, impact, source, targeted и т.д.).

Правила по сути:

- **LO:** пишутся evidence только по чекам с **checkId в формате GSE** (gse:...). У этой попытки loChecks с checkId `question_answered` и т.п. — не GSE, поэтому **LO evidence по нодам не создаётся**.
- **Grammar:** evidence строятся из grammarChecks с валидным descriptorId. Здесь grammarChecks пустые → **грамматических evidence нет**.
- **Vocab:**  
  - Если есть **vocabChecks** с pass=true, по ним пишутся evidence (targeted/incidental по opportunityType и соответствию таргетам).  
  - У этой попытки vocabChecks пустые → срабатывает **fallback**: проверка таргета "ask" по required words/descriptor и **alias-scan по транскрипту** для инцидентальных нод.  
  - В результате: один **vocab_incidental_used** по таргету "ask" (targeted: true, source: rules) и несколько **vocab_incidental_discovery** по нодам, подобранным по алиасам/дескрипторам (targeted: false, source: rules).

### 7.3 Что в итоге в БД (AttemptGseEvidence)

- **1 запись** по таргету vocab "ask": signalType vocab_incidental_used, targeted true, source rules.
- **9 записей** vocab_incidental_discovery по разным нодам (world, happen, important, start, conversation, teacher, question, understand и т.д.) — из alias-scan fallback, все targeted false, source rules.

Дальше по этим evidence обновляется mastery (`applyEvidenceToStudentMastery`), считаются node outcomes, прогресс и т.д.

---

## Краткая схема потока

```
Аудио → [Speech] → transcript + metrics
                    ↓
Task + TaskGseTarget (БД) → taskTargets
                    ↓
evaluateTaskQuality(input)
  → buildSemanticEvaluationContext → parser → LO/Grammar retrieval → lo/grammar candidates
  → buildVocabEvaluationContext → lemma + index → vocab candidates
  → evaluateLoOnly(targetLo, candidateLo)        → loChecks
  → evaluateGrammarOnly(targetGr, candidateGr)   → grammarChecks
  → evaluateVocabOnly(targetVoc, candidateVoc)   → vocabChecks
  → evaluateGeneralOnly(domainSummary)          → taskScore, rubricChecks, feedback
  → merge → taskEvaluation + feedback
  → attachStructuredChecks
                    ↓
Worker: attempt.taskEvaluationJson = taskEvaluation, feedbackJson = feedback
                    ↓
persistAttemptGseEvidence(taskEvaluation, taskTargets, …)
  → по loChecks/grammarChecks/vocabChecks (GSE ID) → evidence из модели
  → при пустых vocabChecks → required-words + alias-scan → evidence source: rules
                    ↓
AttemptGseEvidence в БД → applyEvidenceToStudentMastery → node outcomes, mastery, progress
```

---

## Вывод по последней попытке

- Парсер и retrieval отработали: есть LO intents, grammar patterns, списки кандидатов LO/Grammar/Vocab в логе.
- Split-evaluator отработал: general дал taskScore 100 и feedback; доменные вызовы вернули loChecks не в формате GSE и пустые grammarChecks/vocabChecks.
- Evidence по этой попытке получились в основном из **правил**: один таргетный vocab ("ask") и несколько инцидентальных vocab из alias-scan, все с source: rules. LO и grammar evidence по нодам не записались из-за формата ответа модели и пустых чеков.

Чтобы по такой попытке получать LO/grammar/vocab evidence из модели, ответы evaluateLoOnly / evaluateGrammarOnly / evaluateVocabOnly должны возвращать чеки с корректными GSE ID (nodeId/descriptorId из выданных опций) и не пустые списки там, где в речи есть релевантные конструкции.
