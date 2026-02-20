# CH-39 - Unified cross-modality placement and mastery

## Objective
(1) Use cross-modality placement snapshot during cold start: end cold start when stop criteria are satisfied; bias next task types toward missing modality domains. (2) Add placement confidence report by domain from PromotionAudit (cohort-level observability).

## What Landed

### 1) Cold-start cross-modality in task/next
- Exported placement snapshot builder:
  - `buildCrossModalityPlacementSnapshot(studentId)` in `src/lib/placement.ts`
- Domain → task type mapping for cold-start coverage:
  - `PLACEMENT_DOMAIN_TO_TASK_TYPE` in `src/lib/placement/crossModality.ts`
  - speaking → topic_talk, listening → listening_comprehension, reading → reading_comprehension, writing → writing_prompt, grammar → qa_prompt, vocabulary → target_vocab
- In `src/app/api/task/next/route.ts`:
  - When `coldStartActive`, call `buildCrossModalityPlacementSnapshot(studentId)`.
  - If `stopCriteriaSatisfied`, update `LearnerProfile.coldStartActive = false` and treat cold start as ended for the rest of the request.
  - When building `candidateTaskTypes`, if cold start and `missingDomains.length > 0`, prepend preferred task types for missing domains (filtered by stage-eligible types).

### 2) Placement confidence report
- Contract and schema:
  - `src/lib/contracts/placementConfidenceReport.ts`
  - Version: `placement-confidence-report-v1`
  - By-domain rows: domain, placementCount, totalSampleCount, avgConfidence, avgUncertainty
- Contract test:
  - `src/lib/contracts/placementConfidenceReport.test.ts`
- Quality aggregator:
  - `src/lib/quality/placementConfidenceReport.ts`
  - `buildPlacementConfidenceReport({ windowDays?, limit?, now? })`
  - Queries PromotionAudit in window, keeps rows with `reasonsJson.placement === true` and `reasonsJson.crossModalityPlacement`, aggregates `byDomain` from each audit.
- API and script:
  - `GET /api/quality/placement-confidence?windowDays=&limit=`
  - `src/app/api/quality/placement-confidence/route.ts`
  - `src/scripts/ch39_placement_confidence_report.ts`
  - npm alias: `npm run placement:confidence:report`
  - Default output: `docs/reports/CH39_PLACEMENT_CONFIDENCE_REPORT.json`

## Artifacts
- `docs/reports/CH39_PLACEMENT_CONFIDENCE_REPORT.json`

## Validation
- `npm test -- src/lib/contracts/placementConfidenceReport.test.ts`
- `npm run placement:confidence:report -- --window-days 90 --output docs/reports/CH39_PLACEMENT_CONFIDENCE_REPORT.json`
- `npm run lint`
- `npm run build`
