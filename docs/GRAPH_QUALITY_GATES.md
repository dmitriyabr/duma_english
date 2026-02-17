# Graph Quality Gates

Version: `gse-graph-contract.v1.2026-02-17`

This contract enforces release-blocking graph invariants from the autopilot blueprint:

1. `acyclic prereqs`: prerequisite edges must not form cycles.
2. `edge type validity`: only allowed edge types are accepted.
3. `no orphan critical nodes`: critical nodes (promotion-critical) must be connected by at least one valid edge.
4. `edge drift report`: transfer/prerequisite performance deltas are reported for monitoring.

## Commands

Deterministic contract check (CI-safe, no DB required):

```bash
npm run graph:quality
```

Write JSON report:

```bash
npm run graph:quality -- --output tmp/graph-quality-report.json
```

Run against live database graph and mastery telemetry:

```bash
npm run graph:quality:db
```

## Report fields

- `summary.releaseBlocker`:
  - `true` means one or more blocking invariants failed.
  - `false` means structural graph gates passed.
- `issues`:
  - blocking details (`invalidEdgeTypes`, `danglingEdges`, `selfLoopPrerequisites`, `prerequisiteCycles`, `orphanCriticalNodes`).
- `drift`:
  - `flagged` edges below configured minimum success rate with enough learner support.
  - `topRisk` edges sorted by worst drift delta.

## CI integration

Workflow: `.github/workflows/graph-quality-gates.yml`

CI runs `npm run graph:quality` on each push/PR and uploads `tmp/graph-quality-report.json` as an artifact.
