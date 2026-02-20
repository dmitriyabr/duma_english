# CH-43 — Parent/Teacher Copilot v2

**Status:** DONE  
**Artifact:** Updated teacher API + UI (Copilot section on student page).

## Goal

The teacher/parent interface shows at a glance:
- **Blocker causes** — human-readable reasons why promotion is blocked (from bundle/retention/stress gates).
- **Transfer & retention health** — retention gate status, 7d/30d pass rates, transfer pass rate and evaluable count.
- **ETA to next milestone** — short text derived from readiness score and number of nodes to verify.
- **Recent decisions** — last N planner decisions (task type, selection reason, target descriptors) without raw utility JSON.

## Implementation

### API

- **Endpoint:** `GET /api/teacher/students/[studentId]` (unchanged; response extended).
- **New response key:** `copilot` (optional), with:
  - `blockerCauses: string[]` — unique reason labels from `promotionReadiness.blockedBundlesReadable`.
  - `transferRetentionHealth`: `retentionGatePassed`, `retentionGateRequired`, `retentionPassRate7d`, `retentionPassRate30d`, `transferPassRate`, `transferEvaluableCount`.
  - `etaToNextMilestone: string` — e.g. "Readiness 45%. 3 node(s) to verify for next milestone."
  - `recentDecisions: Array<{ createdAt, chosenTaskType, selectionReason, targetDescriptors }>` — from `PlannerDecisionLog`, last 10; target node IDs resolved to descriptors.

Data sources:
- Blockers/retention/ETA from existing `getStudentProgress()` → `promotionReadiness`.
- Transfer: `OODTaskSpec` for student in last 30 days with `taskInstanceId` set; verdict counts for `transfer_pass` and pass rate.
- Recent decisions: `PlannerDecisionLog` for student, order by `decisionTs` desc, take 10; descriptors from `GseNode` by `targetNodeIds`.

### UI

- **Page:** `/teacher/students/[studentId]`.
- **Section:** "Copilot" card after the domain snapshot, before domain focus cards.
- Renders: blocker list, transfer/retention summary line, ETA paragraph, and up to 5 recent decisions (date, task type, reason, first 3 target descriptors).

## Files

- `src/app/api/teacher/students/[studentId]/route.ts` — copilot payload built and returned.
- `src/app/teacher/students/[studentId]/page.tsx` — `Copilot` type, `copilot` in profile, Copilot section UI.

## References

- Progress and promotion: `src/lib/progress.ts`, `src/lib/gse/stageProjection.ts`.
- Retention: `src/lib/retention/probes.ts`, `src/lib/retention/promotionGate.ts`.
- Planner log: `PlannerDecisionLog` (chosenTaskType, selectionReason, targetNodeIds, decisionTs).
