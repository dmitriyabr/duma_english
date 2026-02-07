# Mastery methodology: can we speed up when correct, slow down when wrong?

Last updated: 2026-02-07

## What research says

- **N-Consecutive Correct (N-CCR):** Advance / declare mastery after N correct in a row. Used by Khan Academy, Duolingo, ASSISTments; supported by Bayesian knowledge tracing as an effective policy.
- **Fast-Forwarding:** Skip steps when all remaining steps are mastered. Reduces overpractice by ~1/3 (Xia et al., “Optimizing Mastery Learning by Fast-Forwarding Over-Practice Steps”, arxiv 2506.17577).
- **Adaptive spacing:** Spacing/intervals based on performance (e.g. ARTS) outperform fixed schedules.
- **Performance Factor Analysis (PFA):** Different learning rates for correct vs incorrect — so consistent success can speed progression, errors slow it.

So: “if I systematically don’t err, speed should go up; if I err, it should go down” is aligned with evidence-based practice.

## What we have today

- **Weights** in `src/lib/gse/mastery.ts` are **fixed** by evidence kind and opportunity (direct+explicit_target=1, supporting+incidental=0.35, negative=0.4–0.9, etc.). There is **no streak bonus** (e.g. “after 3 direct hits in a row, next weight ×1.2”) and **no error penalty** (e.g. “after a negative, next evidence weighted less”).
- **Verification:** One strong direct+explicit_target pass (score ≥ 0.7, confidence ≥ 0.75) can set the node to **verified** immediately. We do **not** use “N correct in a row” to declare verified; one strong hit is enough.
- **Fast credit:** When placement is above a bundle stage, we count nodes as covered if value ≥ 50 and ≥ 1 direct (so we don’t grind to verified+70 on lower levels).

So we **do not** currently implement “systematically correct → speed up; errors → slow down” at the **evidence weight** level.

## Possible additions

1. **Streak bonus on weight:** e.g. last 2–3 direct successes on this node → multiply evidence weight by 1.1–1.2 so the next hit moves mastery more.
2. **N-CCR-style early verification:** e.g. 2–3 direct passes in a row on this node → set verified even if mean < 70.
3. **PFA-style:** Separate effective learning rates for correct vs incorrect in the alpha/beta update (correct adds more to alpha, incorrect adds more to beta / or use different weights for negative evidence after a streak of positives).

See DEBUG_PLAYBOOK for other mastery/evidence details.
