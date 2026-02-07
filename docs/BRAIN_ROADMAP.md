# BRAIN ROADMAP (Active)

Last updated: 2026-02-07

## Priority 1: Vocab Disambiguation
Goal: reduce false-positive incidental vocab mapping.
1. Rank candidate nodes by:
- stage-range proximity
- descriptor/context overlap
- node ambiguity penalty
2. Keep top-k per lexical unit.
3. Add confidence penalties for ambiguous matches.
4. Ship tests for precision regression.

## Priority 2: Verification Queue Enforcement
Goal: observed knowledge must be validated quickly.
1. Add SLA: candidate node gets verification task within next 2 tasks.
2. Planner priority boost for overdue verification nodes.
3. Add queue aging and escalation.
4. Add integration tests for candidate->verified path.

## Priority 3: Promotion Gate Hardening
Goal: stable, explainable stage movement.
1. Enforce per-domain verified coverage thresholds.
2. Enforce min direct evidence counts by domain.
3. Show blockers with human labels and numeric thresholds.
4. Add blocked-vs-promoted integration scenarios.

## Priority 4: Cold-start Rebalance
Goal: avoid narrow early calibration.
1. Rotate domain targets in first diagnostic window.
2. Prevent repeated same-cluster targeting.
3. Add anti-loop assertions in planner tests.
