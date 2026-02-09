# Контекст N-CCR=2: Calibration vs Learning

Дата: 2026-02-09

## Важное уточнение к MASTERY_SPEED_ANALYSIS.md

Первоначальный анализ упустил критически важный контекст: **N-CCR=2 предназначен для быстрой калибровки existing knowledge**, а не для обучения с нуля.

---

## 🎯 Два сценария использования

### Сценарий 1: Cold Start / Calibration (первые 8 попыток)

**Контекст:**
- Новый ученик с **existing knowledge** (например, фактический B2, но система не знает)
- Нужно быстро откалибровать, какие ноды уже known
- Первые 8 попыток = `coldStartActive = true` (`COLD_START_TARGET_ATTEMPTS = 8`)
- Режим: `diagnosticMode = true` в planner

**Пример:**
- Ученик B2 получает задание на A1 vocab "cat"
- Он правильно использует слово 2 раза подряд (direct success)
- N-CCR=2 → **verified** ✅
- **Правильно!** Он уже знал это слово, не нужно 10+ повторений

**N-CCR=2 здесь appropriate:**
- Цель: быстро найти placement level (какой stage ученик реально знает)
- Если ученик легко справляется с A1/A2 нодами → fast track к B1
- Без N-CCR=2 пришлось бы "заново учить" всё, что ученик уже знает

### Сценарий 2: Normal Learning (после cold start)

**Контекст:**
- Ученик прошёл calibration (8+ попыток)
- Placement определён (например, A2)
- Теперь учит **новые** ноды target stage (B1)
- Режим: `coldStartActive = false`, `diagnosticMode = false`

**Пример:**
- Ученик A2 учит новую B1 grammar "Can use cleft sentences"
- Он правильно использует конструкцию 2 раза подряд (direct success)
- N-CCR=2 → **verified** ⚠️
- **Слишком рано?** Это новая конструкция, 2 успеха могут быть случайными

**N-CCR=2 здесь questionable:**
- Исследование рекомендует 10-12 встреч для **продуктивного знания нового**
- 2 success могут быть: (a) guided by prompt, (b) простой контекст, (c) угадал
- Риск: ученик получит verified, но забудет конструкцию через неделю

---

## 📊 Текущая реализация

### Код (mastery.ts, линии 362-370):

```typescript
if (activationStateBefore !== "verified" && verificationPass) {
  // Вариант A: one-shot verification
  activationStateAfter = "verified";
  verificationDueAt = null;
  activationImpact = "verified";
} else if (
  activationStateBefore !== "verified" &&
  nextStreak >= 2 &&  // N-CCR = 2
  directSuccess
) {
  // Вариант B: N-CCR early verification
  activationStateAfter = "verified";
  verificationDueAt = null;
  activationImpact = "verified";
}
```

**Проблема:** Нет дифференциации по контексту.
- N-CCR=2 применяется **всегда** (и в cold start, и в normal learning)
- Нет проверки на `diagnosticMode`, `coldStartActive`, `placementStage vs nodeStage`

### Cold Start логика (adaptive.ts, линии 140-158):

```typescript
const COLD_START_TARGET_ATTEMPTS = 8;

async function getColdStartState(studentId: string) {
  const attempts = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    include: { task: { select: { type: true, metaJson: true } } },
    orderBy: { completedAt: "desc" },
    take: 20,
  });
  const nonPlacement = attempts.filter((a) => !isPlacementAttemptMeta(a.task.metaJson));
  const completed = nonPlacement.length;

  return {
    active: completed < COLD_START_TARGET_ATTEMPTS,
    completed,
    nextSkill: /* ... */
  };
}
```

**Вывод:** Cold start есть, но **не используется в mastery.ts для N-CCR**.

---

## 🔍 Анализ: Нужна ли дифференциация?

### Аргументы ЗА дифференциацию:

**1. Known vs New knowledge фундаментально разные:**
- Known (calibration): 2 success достаточно (ученик уже владеет)
- New (learning): 2 success недостаточно (может быть случайность)

**2. Исследования поддерживают:**
- BKT-сценарии: оптимальное N = **2-8** (широкий диапазон!)
- Для лёгких элементов (known): **2-5** ✅
- Для сложных элементов (new): **8-15** ✅
- Pelánék: "выбор порогов важнее модели"

**3. Риск false positives в learning режиме:**
```
Попытка 1 (direct, new grammar): Pass (с подсказкой в промпте)
Попытка 2 (direct, same grammar): Pass (вспомнил из попытки 1)
→ verified! Но через неделю забудет.
```

**4. Placement vs Target stage gap:**
- Если `placementStage = A2`, `nodeStage = A1` → ученик знает, N-CCR=2 ✅
- Если `placementStage = A2`, `nodeStage = B1` → ученик учит, N-CCR=2 ⚠️

### Аргументы ПРОТИВ дифференциации:

**1. Текущая система уже "медленная" для новых нод:**
- Новая нода начинает с activationState = "observed"
- Чтобы попасть в "candidate_for_verification" нужно:
  - ≥3 incidental observations
  - ≥2 task types
  - median confidence ≥ 0.7
- **Только потом** планировщик даёт explicit target → N-CCR может сработать
- Итого: минимум 3 incidental + 2 direct = **5+ встреч** для verified

**2. N-CCR=2 срабатывает редко на новых нодах:**
- Для совсем новой ноды (0 evidence) нужно:
  - Сначала observed (incidental)
  - Потом candidate (3+ incidental в 2+ task types)
  - Потом 2 direct explicit
- Значит, N-CCR=2 в основном срабатывает на **almost-known** нодах

**3. Complexity vs value:**
- Добавление режимов (diagnostic, coldStart, placementGap) усложняет логику
- Текущая простая система может быть "good enough"

---

## 💡 Пересмотр рекомендаций

### Вариант A: Context-aware N-CCR (более точно)

```typescript
function getNcrThreshold(context: {
  diagnosticMode: boolean;
  placementStage: CEFRStage;
  nodeStage: CEFRStage;  // from gseCenter
  nodeType: "GSE_VOCAB" | "GSE_GRAMMAR" | "GSE_LO";
  evidenceCount: number;
}): number {
  // 1. Diagnostic/cold start mode: быстрая калибровка
  if (context.diagnosticMode) return 2;

  // 2. Below placement (known knowledge): быстрое verified
  const placementIdx = stageIndex(context.placementStage);
  const nodeIdx = stageIndex(context.nodeStage);
  if (nodeIdx < placementIdx - 1) return 2; // ≥2 stages below placement
  if (nodeIdx < placementIdx) return 3;     // 1 stage below

  // 3. At/above placement (new learning): строгий порог
  if (context.nodeType === "GSE_VOCAB") return 4;
  if (context.nodeType === "GSE_GRAMMAR") return 5;
  return 5; // LO
}

// В mastery.ts:
const nCcrRequired = getNcrThreshold({
  diagnosticMode: /* передать из params */,
  placementStage: /* из studentProfile или projection */,
  nodeStage: gseBandFromCenter(node.gseCenter),
  nodeType: node.type,
  evidenceCount: nextCount
});

if (nextStreak >= nCcrRequired && directSuccess) {
  activationStateAfter = "verified";
}
```

**Эффект:**
- B2 ученик + A1 vocab "cat" → N-CCR=2 (быстро) ✅
- A2 ученик + B1 grammar "cleft" → N-CCR=5 (строго) ✅
- Cold start (первые 8) → N-CCR=2 (diagnostic) ✅

### Вариант B: Простой компромисс (easier)

```typescript
// Фиксированный N-CCR=3 для всех (вместо 2)
// Достаточно для быстрой calibration, но менее рискованно для new learning
if (nextStreak >= 3 && directSuccess) {
  activationStateAfter = "verified";
}
```

**Эффект:**
- Калибровка чуть медленнее (3 вместо 2), но всё ещё быстро
- New learning чуть строже (3 вместо 2)
- Aligned с исследованием: "3-5 для лёгких элементов" ✅

### Вариант C: Оставить как есть + добавить spacing bonus

**Логика:**
- N-CCR=2 технически OK, потому что:
  - Для known: работает как надо (быстро)
  - Для new: срабатывает редко (нужно пройти candidate pipeline сначала)
- **Главная проблема не N-CCR, а отсутствие spacing bonus**

**Focus на spacing:**
- Даже если verified за 2 direct success, **без spacing** масtery не дойдёт до 80-90
- С spacing bonus: 2 direct (1 день) → 70, но 10 distributed (месяц) → 90 ✅
- Это лучше отражает "я знаю vs я помню долгосрочно"

---

## 🎯 Финальная рекомендация

### Приоритет 1: **Spacing bonus** (критичен для обоих сценариев)
- Решает проблему и для calibration, и для learning
- Known knowledge с spacing → устойчиво высокий mastery
- New learning с spacing → долгосрочное удержание
- **Impact: HIGH, Effort: MEDIUM**

### Приоритет 2: **Context-aware N-CCR** (если есть ресурсы)
- Более точная калибровка vs learning
- Вариант A (context-aware) — если хочется precision
- Вариант B (N-CCR=3 для всех) — если хочется simplicity
- **Impact: MEDIUM, Effort: LOW (Variant B) / MEDIUM (Variant A)**

### Приоритет 3: **Cap увеличение** (опционально)
- Изначальный анализ переоценил важность (без учёта cold start контекста)
- Текущий cap=12 OK для calibration (быстрый рост нужен)
- Для new learning spacing bonus важнее, чем cap
- **Impact: LOW-MEDIUM, Effort: LOW**

---

## 📝 Пересмотр MASTERY_SPEED_ANALYSIS.md

**Что верно осталось:**
✅ Spacing bonus критичен (85% vs 22% retention)
✅ Decay реализован хорошо
✅ Difficulty multiplier полезен

**Что нужно пересмотреть:**
⚠️ N-CCR=2 не "слишком агрессивен" в контексте calibration
⚠️ Cap=12 не "слишком быстрый" для known knowledge
⚠️ Проблема не в скорости роста, а в **отсутствии spacing reward**

**Новый приоритет:**
1. 🔥 **Spacing bonus** (must have)
2. ⚪ Context-aware N-CCR (nice to have)
3. ⚪ Difficulty multiplier (nice to have)
4. ❌ Cap увеличение (не нужно, если есть spacing)

---

## TL;DR для команды

**Вопрос:** "N-CCR=2 слишком агрессивен?"

**Ответ:**
- Для **calibration** (B2 ученик + A1 ноды): **N-CCR=2 правильно** ✅
- Для **new learning** (A2 ученик + B1 ноды): **N-CCR=2 рискованно**, но редко срабатывает (нужно пройти candidate pipeline)
- **Главная проблема не N-CCR, а отсутствие spacing bonus** — можно получить verified за 2 дня, но забыть через неделю

**Action items:**
1. Добавить **spacing bonus** (20% за 1-14 дней между evidence) — критично для долгосрочного удержания
2. Опционально: context-aware N-CCR (2 для calibration, 3-5 for learning)
3. Не трогать cap (12 OK для быстрой calibration)
