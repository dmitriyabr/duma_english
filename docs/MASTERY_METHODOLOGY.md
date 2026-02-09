# Mastery methodology: can we speed up when correct, slow down when wrong?

Last updated: 2026-02-08

## What research says

- **N-Consecutive Correct (N-CCR):** Advance / declare mastery after N correct in a row. Used by Khan Academy, Duolingo, ASSISTments; supported by Bayesian knowledge tracing as an effective policy.
- **Fast-Forwarding:** Skip steps when all remaining steps are mastered. Reduces overpractice by ~1/3 (Xia et al., “Optimizing Mastery Learning by Fast-Forwarding Over-Practice Steps”, arxiv 2506.17577).
- **Adaptive spacing:** Spacing/intervals based on performance (e.g. ARTS) outperform fixed schedules.
- **Performance Factor Analysis (PFA):** Different learning rates for correct vs incorrect — so consistent success can speed progression, errors slow it.

So: “if I systematically don’t err, speed should go up; if I err, it should go down” is aligned with evidence-based practice.

## How it should work (spec)

**Принцип:** Один осознанный множитель за тип evidence (direct vs supporting). Без двойных/тройных штрафов в разных слоях.

1. **Evidence (пайплайн)** — что кладём в каждое доказательство:
   - **confidence:** насколько мы доверяем оценке **конкретной проверки** (per check). Один источник: надёжность скоринга попытки (scoreReliability → high 0.9 / medium 0.7 / low 0.5). Для direct и для supporting — **одинаково**.
   - **reliability:** надёжность **попытки в целом** (per attempt): scoreReliability. Для direct и supporting — **одинаково**.
   - **baseWeight:** единственный категориальный коэффициент; задаётся парой (kind, opportunity), в формулу веса не входит impact и не используется target.weight.

2. **Mastery (обновление α, β):** effectiveWeight = baseWeight(kind, opportunity) × confidence × reliabilityFactor(reliability) × PFA × streak. Один коэффициент за категорию — baseWeight. Значения: plus (direct/supporting) = 1 при любом opportunity; negative: explicit_target 0.9, incidental (и остальное) 0.6. Ограничений по минимуму/максимуму веса нет.

3. **Итог:** Supporting и direct при одинаковых conf/rel дают одинаковый прирост (baseWeight = 1). Разница только в том, какие conf/rel выставляются в пайплайне.

## What we have today

- **Incidental (LO, grammar, vocab):** One rule for all: evaluator returns a check only when the node was evidenced in the transcript (used or attempted). No check → no evidence. pass → supporting (plus), !pass → negative (minus). Vocab incidental now writes negative on pass false like grammar/LO.
- **Weights:** формула веса = baseWeight × conf × rel × PFA × streak; conf — per check, rel — per attempt; единственный категориальный коэффициент = baseWeight. **Streak:** ×1.25, ×1.56, ×1.8 (cap 1.8). **PFA:** score ≥ 0.6 → ×1.1, score &lt; 0.4 → ×0.9.
- **Verification:** One strong direct pass → verified; or **N-CCR:** 2 successes in a row (direct or supporting) → verified even if mean &lt; 70.
- **Bounded memory:** α+β capped at **12** so each evidence gives a visible delta (streak ×1.56 → ~2+ points, not +0.6); mastery can reach 70 in 15–25 reps.
- **Fast credit:** When placement is above a bundle stage, node counts as covered if value ≥ 50 and ≥ 1 direct.

## Why you see so few streaks and small deltas (+0.6, +1.0)

**Real profile data (inspect_profile_evidence.ts):** The vast majority of evidence is **supporting + incidental** (e.g. vocab_incidental_used: “word was used in speech” but the task was not a target_vocab with that word in required words). Example: “ask” had **0 direct**, 8 supporting; “play” had **0 direct**, 35 supporting.

- **Streak applies only when** kind = **direct** and score ≥ 0.7. So if almost every hit is “supporting”, you will almost never see “streak ×1.15” in the log.
- **Small deltas:** supporting+incidental и direct+explicit_target используют один baseWeight (1); при одинаковых conf/rel прирост одинаковый. We never get **direct** (word was the explicit target and you used it) unless the task was target_vocab or the prompt listed that word in "Use: …".

**Spaced repetition:** Decay (mastery падает со временем) is correct. The issue is not decay but **low weight of repeated correct use** when it’s classified as supporting. In principle, “used the word correctly in context” many times should strengthen the estimate; we currently don’t boost that.

## Done: repeated supporting boost

- After **5+ supporting observations** on the same node, the next **supporting + incidental** evidence with score ≥ 0.6 gets weight ×**1.5**. So “used the word many times” (e.g. play ×35, ask ×8) accumulates faster: the 6th, 7th, … such hit moves the mean more. Implemented in `mastery.ts`.

## Possible next steps (methodology)

1. **More direct evidence:** Planner / task choice could schedule more **target_vocab** (or prompts with “Use: X, Y”) for nodes that already have many supporting hits, so the next hit becomes direct → streak can apply and growth speeds up.
2. **Supporting → “quasi-direct” after N successes:** After e.g. 5+ supporting observations on the same node with score ≥ 0.6 each, treat the next supporting hit as direct for **weight** (and optionally for streak). So repeated correct use accumulates without requiring the task to be explicit target.
3. ~~Higher weight for repeated supporting~~ (done above): See "Done: repeated supporting boost" above.

See DEBUG_PLAYBOOK for other mastery/evidence details. Run `npx tsx src/scripts/inspect_profile_evidence.ts [studentId]` to see your evidence mix and why streaks are rare.
