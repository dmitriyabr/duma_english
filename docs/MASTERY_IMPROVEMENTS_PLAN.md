# Plan: streak-based and PFA-style mastery improvements

Last updated: 2026-02-07

## Goal

Implement evidence-based behaviour: **systematically correct → speed up; errors → slow down.**

- **Streak bonus:** After 1+ direct success on a node, the next direct success gets a higher evidence weight so mastery rises faster.
- **N-CCR-style early verification:** 2 direct successes in a row on a node → set **verified** even if mean &lt; 70 (so we don’t require many more attempts once the learner is clearly correct).
- **PFA-style:** Correct evidence (score ≥ 0.6) gets a slightly higher effective weight; incorrect (score &lt; 0.4) gets a slightly lower one.

## Scope

- **Where:** `src/lib/gse/mastery.ts` in `applyEvidenceToStudentMastery`.
- **Storage:** Reuse `spacingStateJson`: add `directSuccessStreak` (number). No new DB columns.
- **Behaviour:** Backward compatible: missing `directSuccessStreak` treated as 0.

## Implementation steps

### 1) Streak tracking

- Read `directSuccessStreak` from `spacingStateJson` (default 0).
- **Direct success:** `kind === "direct"` and `score >= 0.7`.
- **Next streak:** if direct success then `directSuccessStreak + 1`, else `0`.
- When persisting, write `spacingStateJson` with existing incidental fields **and** `directSuccessStreak: nextStreak`.

### 2) Streak bonus on weight

- **Что говорят модели:** В PFA веса правильных/неправильных ответов часто линейны по *количеству* попыток; в spaced repetition (FSRS и др.) множители после серии успехов восстанавливаются постепенно и ограничены сверху, чтобы не раздувать интервалы без предела. Итого: разумно не давать неограниченный рост бонуса — либо **линейный рост до потолка**, либо **экспонента с cap** (второй успех +15%, третий ещё +≈15% от базы, дальше cap).
- Реализация: **экспонента с потолком.** Если текущее свидетельство — прямой успех и предыдущая серия ≥ 1:
  - множитель = `min(STREAK_BONUS_CAP, STREAK_BONUS_BASE ** min(prevStreak, STREAK_BONUS_STEPS))`;
  - константы: база 1.15, потолок множителя 1.20, «шагов» 2 → 2-й успех подряд ×1.15, 3-й и далее ×1.20 (1.15² ≈ 1.32 → обрезаем до 1.20).
- Итоговый вес по-прежнему clamp [0.05, 1.2].

### 3) N-CCR-style early verification

- After existing verification logic (one strong pass → verified):
  - If still not verified and **nextStreak >= 2** and current evidence is a direct success, set `activationStateAfter = "verified"`, `verificationDueAt = null`, `activationImpact = "verified"`.
- So 2 direct successes in a row on the same node → verified even if mean &lt; 70.

### 4) PFA-style correct/incorrect multiplier

- After base weight (and before or after streak bonus; we do after streak):
  - If `score >= 0.6`: multiply effective weight by **1.1**.
  - If `score < 0.4`: multiply by **0.9**.
- Keeps weights in [0.05, 1.2] with a final clamp.

### 5) Order of application

1. Base `computedWeight` (unchanged).
2. PFA: `weight *= score >= 0.6 ? 1.1 : score < 0.4 ? 0.9 : 1`.
3. Streak bonus: if direct success and previous streak ≥ 1, `weight *= min(1.20, 1.15^min(prevStreak, 2))` (2nd → ×1.15, 3rd+ → ×1.20).
4. Clamp weight to [0.05, 1.2].
5. Use this weight for `alphaAfter` / `betaAfter`.
6. Verification: (a) existing one-shot pass, or (b) nextStreak >= 2 and direct success → verified.

## Testing / follow-up

- Run existing tests; add a unit test for streak and N-CCR if present.
- After deploy, observe: nodes with 2 direct hits in a row should become verified sooner; mastery should rise a bit faster on consistent success.

## References

- MASTERY_METHODOLOGY.md (research summary)
- mastery.ts `baseWeight`, `applyEvidenceToStudentMastery`
