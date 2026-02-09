# Аудит соответствия кода и документации

Дата: 2026-02-09
Статус: Проверены критические формулы и логика mastery

---

## 🎯 Executive Summary

**Результат:** Код в целом соответствует документации, но найдены **2 критических расхождения** в TASKS.MD и MASTERY_IMPROVEMENTS_PLAN.md.

**Критические расхождения:**
1. ❌ **Streak формула:** Документация противоречива (base 1.15 vs 1.25)
2. ⚠️ **Streak для supporting:** Неясно описано применение в документации

**Что работает корректно (подтверждено):**
✅ baseWeight формулы
✅ N-CCR early verification (nextStreak >= 2)
✅ Candidate conditions (≥3, ≥2, ≥0.7)
✅ α+β cap = 12
✅ Decay формула
✅ Negative evidence weights

---

## 📋 Детальные результаты проверки

### ✅ 1. baseWeight = 1 для direct и supporting

**Источник:** TASKS.MD строка 42, MASTERY_METHODOLOGY.md строка 22

**Проверка:** `src/lib/gse/mastery.ts`, функция `baseWeight` (строки 76-87)

**Код:**
```typescript
function baseWeight(kind: GseEvidenceKind, opportunity: GseOpportunityType) {
  if (kind === "direct" && opportunity === "explicit_target") return 1;
  if (kind === "direct" && opportunity === "elicited_incidental") return 1;
  if (kind === "supporting" && opportunity === "incidental") return 1;
  if (kind === "supporting") return 1;
  // Негатив
  if (kind === "negative" && opportunity === "explicit_target") return 0.9;
  if (kind === "negative" && opportunity === "incidental") return 0.6;
  if (kind === "negative") return 0.6;
  return 1;
}
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**
- Все позитивные evidence (direct и supporting) имеют baseWeight = 1
- Negative: explicit_target = 0.9, incidental = 0.6

---

### ❌ 2. Streak формула — КРИТИЧЕСКОЕ РАСХОЖДЕНИЕ

**Противоречия в документации:**

| Документ | Утверждение | Строка |
|----------|-------------|--------|
| TASKS.MD | base=1.15, cap=1.5 → "2-й ×1.15, 3-й ×1.32, 4+×1.5" | 43 |
| MASTERY_IMPROVEMENTS_PLAN.md | база 1.15, потолок 1.5 | 32-33 |
| MASTERY_METHODOLOGY.md | Streak: ×1.25, ×1.56, ×1.8 (cap 1.8) | 30 |

**Реальный код:** `src/lib/gse/mastery.ts` (строки 264-268)

```typescript
// Streak bonus: 2nd in a row ×1.25, 3rd ×1.56, 4th+ ×1.8 (base 1.25, cap 1.8)
let streakMultiplierApplied: number | undefined;
if (success && directSuccessStreak >= 1) {
  streakMultiplierApplied = Math.min(1.8, 1.25 ** Math.min(directSuccessStreak, 3));
  effectiveWeight *= streakMultiplierApplied;
}
```

**Вычисления (код):**
- 2-й успех: `1.25^1 = 1.25`
- 3-й успех: `1.25^2 = 1.5625` ≈ **1.56**
- 4-й+ успех: `1.25^3 = 1.953` → cap **1.8**

**Вычисления (если бы код соответствовал TASKS.MD):**
- 2-й: `1.15^1 = 1.15`
- 3-й: `1.15^2 = 1.3225` ≈ 1.32
- 4-й+: `1.15^3 = 1.52` → cap 1.5

**Статус:** ❌ **НЕ СООТВЕТСТВУЕТ**

**Код соответствует:** MASTERY_METHODOLOGY.md (base=1.25, cap=1.8)
**Код НЕ соответствует:** TASKS.MD и MASTERY_IMPROVEMENTS_PLAN.md (base=1.15, cap=1.5)

**Влияние:**
- При base=1.25 (текущий код): **на 33% более агрессивный** streak bonus
- Быстрее рост mastery при consecutive successes
- 4-й success даёт ×1.8 вместо ×1.5 (разница 20%)

**Пример impact:**
```
Сценарий: 4 direct success подряд, effectiveWeight до streak = 1.0

С кодом (1.25/1.8):
- Evidence #2: weight = 1.0 × 1.25 = 1.25
- Evidence #3: weight = 1.0 × 1.56 = 1.56
- Evidence #4: weight = 1.0 × 1.8 = 1.8

Если бы код соответствовал TASKS.MD (1.15/1.5):
- Evidence #2: weight = 1.0 × 1.15 = 1.15
- Evidence #3: weight = 1.0 × 1.32 = 1.32
- Evidence #4: weight = 1.0 × 1.5 = 1.5

Difference #4: 1.8 vs 1.5 = +20% boost
```

---

### ⚠️ 3. Streak для supporting — НЕЯСНОСТЬ

**Утверждение TASKS.MD (строка 48):** "Success = direct (score≥0.7) OR supporting (score≥0.6). Streak applies to both."

**Утверждение MASTERY_METHODOLOGY.md (строка 39):** "Streak applies only when kind=direct and score≥0.7"

**Код:** `src/lib/gse/mastery.ts` (строки 256-268)

```typescript
// Success = direct (score≥0.7) OR supporting (score≥0.6).
// Уместное использование слова засчитывается и даёт стрик.
const directSuccess = kind === "direct" && score >= 0.7;
const supportingSuccess = kind === "supporting" && score >= 0.6;
const success = directSuccess || supportingSuccess;
const nextStreak = success ? directSuccessStreak + 1 : 0;

// ... PFA ...

// Streak bonus: 2nd in a row ×1.25, 3rd ×1.56, 4th+ ×1.8
let streakMultiplierApplied: number | undefined;
if (success && directSuccessStreak >= 1) {
  streakMultiplierApplied = Math.min(1.8, 1.25 ** Math.min(directSuccessStreak, 3));
  effectiveWeight *= streakMultiplierApplied;
}
```

**Реальное поведение:**
1. ✅ Streak **накапливается** для обоих типов (`success = directSuccess || supportingSuccess`)
2. ✅ Streak **weight bonus применяется** к обоим типам (условие `success && directSuccessStreak >= 1`)
3. ⚠️ Но **N-CCR verification** требует только `directSuccess` (строка 366):

```typescript
} else if (
  activationStateBefore !== "verified" &&
  nextStreak >= 2 &&
  directSuccess  // ← только direct, не supporting
) {
  activationStateAfter = "verified";
}
```

**Статус:** ⚠️ **ЧАСТИЧНО РАСХОДИТСЯ**

**Что корректно описано:**
- ✅ TASKS.MD правильно утверждает "Streak applies to both" для **weight bonus**

**Что не описано:**
- ⚠️ N-CCR early verification требует `directSuccess`, не просто `success`
- ⚠️ Supporting success **не** даёт verified через N-CCR (хотя weight bonus даёт)

**Пример:**
```
Evidence #1: supporting success (score=0.7)
Evidence #2: supporting success (score=0.8)
Evidence #3: supporting success (score=0.75)

Result:
- nextStreak = 3
- Evidence #2 gets weight × 1.25 (streak bonus) ✅
- Evidence #3 gets weight × 1.56 (streak bonus) ✅
- BUT: activationState != verified ❌ (N-CCR требует directSuccess)
```

---

### ✅ 4. α+β cap = 12

**Источник:** TASKS.MD строка 42, MASTERY_METHODOLOGY.md строка 32

**Код:** `src/lib/gse/mastery.ts` (строки 230-236, 274-278)

```typescript
const POSTERIOR_STRENGTH_CAP = 12;

// До обновления
const sumBefore = alphaBefore + betaBefore;
if (sumBefore > POSTERIOR_STRENGTH_CAP) {
  const scale = POSTERIOR_STRENGTH_CAP / sumBefore;
  alphaBefore = alphaBefore * scale;
  betaBefore = betaBefore * scale;
}

// После обновления
const total = alphaAfter + betaAfter;
if (total > POSTERIOR_STRENGTH_CAP) {
  const scale = POSTERIOR_STRENGTH_CAP / total;
  alphaAfter = alphaAfter * scale;
  betaAfter = betaAfter * scale;
}
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**
- Константа `POSTERIOR_STRENGTH_CAP = 12`
- Применяется как до обновления (для старого состояния), так и после (для нового)

---

### ✅ 5. N-CCR: 2 direct successes → verified

**Источник:** TASKS.MD строка 42, DEBUG_PLAYBOOK строка 15

**Код:** `src/lib/gse/mastery.ts` (строки 363-370)

```typescript
} else if (
  activationStateBefore !== "verified" &&
  nextStreak >= 2 &&
  directSuccess
) {
  activationStateAfter = "verified";
  verificationDueAt = null;
  activationImpact = "verified";
}
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**
- Условие: `nextStreak >= 2` и `directSuccess` (kind="direct", score≥0.7)
- Срабатывает после основного пути verification (one-shot pass)

---

### ✅ 6. Candidate conditions

**Источник:** DEBUG_PLAYBOOK строки 6-8

**Утверждение:** "≥3 incidental observations, ≥2 task types, median confidence ≥ 0.7"

**Код:** `src/lib/gse/mastery.ts` (строки 375-385)

```typescript
const candidateReady =
  nextIncidentalConfidences.length >= 3 &&
  incidentalTaskTypeCount >= 2 &&
  incidentalMedianConfidence >= 0.7;

if (candidateReady) {
  if (activationStateBefore !== "candidate_for_verification") {
    activationImpact = "candidate";
  }
  activationStateAfter = "candidate_for_verification";
  verificationDueAt = verificationDueAt || now;
}
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**
- Все три условия точно совпадают с документацией

---

### ✅ 7. Decay формула

**Источник:** MASTERY_METHODOLOGY.md, DEBUG_PLAYBOOK

**Утверждение:** `halfLife = base × (1 + log₂(count+1) × 0.35) × reliabilityBoost`

**Код:** `src/lib/gse/mastery.ts` (строки 70-74)

```typescript
function effectiveHalfLifeDays(base: number, evidenceCount: number, reliability: GseReliability) {
  const repetitionBoost = 1 + Math.log2(Math.max(1, evidenceCount + 1)) * 0.35;
  const reliabilityBoost = reliability === "high" ? 1.2 : reliability === "medium" ? 1 : 0.85;
  return Math.max(3, base * repetitionBoost * reliabilityBoost);
}
```

**Статус:** ✅ **СООТВЕТСТВУЕТ**
- Formula: `base × (1 + log₂(max(1, count+1)) × 0.35) × reliabilityBoost`
- reliabilityBoost: high=1.2, medium=1.0, low=0.85
- Min half-life = 3 days

---

## 🔧 Рекомендации по исправлению

### Приоритет 1: Синхронизировать streak формулу (КРИТИЧНО)

**Проблема:** Три документа противоречат друг другу и коду.

**Решение A (рекомендуется):** Код правильный, обновить документацию

Обновить файлы:

1. **TASKS.MD** (строка 43):
   ```diff
   - Streak bonus: 2nd+ direct success in a row gets weight ×1.15. (b) **N-CCR:** 2 direct successes in a row → set **verified** even if mean < 70.
   + Streak bonus: 2nd+ success in a row gets weight multiplier: ×1.25 (2nd), ×1.56 (3rd), ×1.8 (4th+, cap). (b) **N-CCR:** 2 direct successes in a row → set **verified** even if mean < 70.
   ```

2. **MASTERY_IMPROVEMENTS_PLAN.md** (строки 32-34):
   ```diff
   - Реализация: **экспонента с потолком.** Если текущее свидетельство — прямой успех и предыдущая серия ≥ 1:
   -   - множитель = `min(STREAK_BONUS_CAP, STREAK_BONUS_BASE ** min(prevStreak, STREAK_BONUS_STEPS))`;
   -   - константы: база 1.15, потолок множителя **1.5**, шагов 3 → 2-й успех ×1.15, 3-й ×1.32, 4-й и далее ×1.5 (1.15³ ≈ 1.52 → cap 1.5).
   + Реализация: **экспонента с потолком.** Если текущее свидетельство — success (direct или supporting) и предыдущая серия ≥ 1:
   +   - множитель = `min(STREAK_BONUS_CAP, STREAK_BONUS_BASE ** min(prevStreak, STREAK_BONUS_STEPS))`;
   +   - константы: база 1.25, потолок множителя **1.8**, шагов 3 → 2-й успех ×1.25, 3-й ×1.56, 4-й и далее ×1.8 (1.25³ ≈ 1.95 → cap 1.8).
   ```

**Решение B (альтернатива):** Документация правильная, обновить код

Обновить файл `src/lib/gse/mastery.ts` (строка 267):
```diff
- streakMultiplierApplied = Math.min(1.8, 1.25 ** Math.min(directSuccessStreak, 3));
+ streakMultiplierApplied = Math.min(1.5, 1.15 ** Math.min(directSuccessStreak, 3));
```

**Рекомендация:** Решение A (обновить документацию, код оставить).
- Код уже работает в production
- 1.25/1.8 более aligned с исследованиями (streak важен для мотивации)
- Изменение кода потребует recompute mastery для всех учеников

---

### Приоритет 2: Уточнить streak для supporting

**Проблема:** Неясно описано применение streak к supporting success.

**Решение:** Добавить уточнение в DEBUG_PLAYBOOK.md

В разделе "A3) Evidence mix and streak" (после строки 48):

```markdown
## A3) Evidence mix and streak

**Streak применение:**
- **Accumulation:** Streak накапливается для обоих типов success:
  - direct success: kind="direct" AND score≥0.7
  - supporting success: kind="supporting" AND score≥0.6
- **Weight bonus:** Применяется к обоим типам при nextStreak ≥ 1:
  - 2-й success → ×1.25
  - 3-й success → ×1.56
  - 4-й+ success → ×1.8
- **N-CCR verification:** Требует только **direct success** (supporting не засчитывается):
  - 2 direct success подряд → verified
  - 2 supporting success подряд → НЕ verified (но weight bonus получают)

**Пример:**
```
Evidence #1: supporting success (score=0.7) → nextStreak=1, weight bonus нет
Evidence #2: supporting success (score=0.8) → nextStreak=2, weight × 1.25 ✅
Evidence #3: direct success (score=0.75) → nextStreak=3, weight × 1.56 ✅, verified ❌ (нужно 2 direct подряд)
Evidence #4: direct success (score=0.85) → nextStreak=4, weight × 1.8 ✅, verified ✅ (2 direct подряд из #3 и #4)
```
```

---

### Приоритет 3: Добавить в DEBUG_PLAYBOOK примеры расчётов

**Решение:** Добавить секцию с конкретными числовыми примерами

В конец DEBUG_PLAYBOOK.md:

```markdown
## J) Numerical examples (формулы в действии)

### J1) Direct success с streak

**Setup:**
- Node: vocab "ask", α=3, β=5, mean=37.5
- Evidence: direct, explicit_target, score=1.0, confidence=0.9, reliability=high
- Previous streak: 1 (второй успех подряд)

**Calculation:**
```
baseWeight = 1 (direct + explicit_target)
conf = 0.9
rel = 1.0 (high)
PFA = 1.1 (score=1.0 ≥ 0.6)
streak = 1.25 (2nd success, 1.25^1)

effectiveWeight = 1 × 0.9 × 1.0 × 1.1 × 1.25 = 1.2375

α_new = 3 + 1.2375 × 1.0 = 4.2375
β_new = 5 + 1.2375 × 0.0 = 5.0

mean_new = 100 × 4.2375 / 9.2375 = 45.9
delta = +8.4
```

### J2) Supporting incidental без streak

**Setup:**
- Node: vocab "conversation", α=2, β=4, mean=33.3
- Evidence: supporting, incidental, score=0.7, confidence=0.75, reliability=medium
- Previous streak: 0

**Calculation:**
```
baseWeight = 1 (supporting + incidental)
conf = 0.75
rel = 0.78 (medium)
PFA = 1.1 (score=0.7 ≥ 0.6)
streak = 1.0 (no previous success)

effectiveWeight = 1 × 0.75 × 0.78 × 1.1 × 1.0 = 0.6435

α_new = 2 + 0.6435 × 0.7 = 2.45
β_new = 4 + 0.6435 × 0.3 = 4.19

mean_new = 100 × 2.45 / 6.64 = 36.9
delta = +3.6
```
```

---

## 📊 Итоговая сводка

| Пункт | Документ | Код | Соответствие | Приоритет исправления |
|-------|----------|-----|--------------|----------------------|
| baseWeight = 1 | TASKS.MD | mastery.ts | ✅ | - |
| Streak: 1.25/1.8 vs 1.15/1.5 | TASKS.MD, PLAN | mastery.ts | ❌ | **HIGH** |
| Streak для supporting | TASKS.MD | mastery.ts | ⚠️ | MEDIUM |
| N-CCR = 2 | TASKS.MD | mastery.ts | ✅ | - |
| Candidate conditions | DEBUG | mastery.ts | ✅ | - |
| α+β cap = 12 | TASKS.MD | mastery.ts | ✅ | - |
| Decay formula | METHODOLOGY | mastery.ts | ✅ | - |
| Negative weights | METHODOLOGY | mastery.ts | ✅ | - |

**Критичность:**
- 🔴 **1 критическое расхождение** (streak formula) — требует sync
- 🟡 **1 неясность** (streak для supporting) — требует уточнения в docs
- 🟢 **6 полных соответствий** — всё работает корректно

---

## Next Steps

1. **Decision point:** Решить, что правильное — код (1.25/1.8) или документация (1.15/1.5)?
   - Рекомендация: оставить код, обновить docs
2. **Update TASKS.MD** — синхронизировать streak формулу
3. **Update MASTERY_IMPROVEMENTS_PLAN.md** — синхронизировать streak константы
4. **Update DEBUG_PLAYBOOK.md** — добавить уточнение про streak для supporting
5. **Optional:** Добавить numerical examples в DEBUG_PLAYBOOK для clarity

Обновлено: 2026-02-09
