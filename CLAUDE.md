# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Duma Speaking Trainer is an AI-powered speaking assessment system for language learners. The system is **GSE-first** (Global Scale of English): all learning decisions—task planning, progress tracking, and stage promotion—are based on GSE node evidence (vocabulary, grammar, and learning objectives), not legacy skill averages.

**Core principles:**
- No kludges: Never guess types from text. Types come from data (node.type, domain, targetNodeTypes from planner/API).
- One source of truth per context: Task words and target nodes come from the planner, not from separate queues.
- LLMs never see or return raw node IDs—only human-readable descriptors/objectives.

## Common Commands

### Development
```bash
npm install                    # Install dependencies
npx prisma generate           # Generate Prisma client (required after schema changes)
npx prisma migrate dev        # Run pending migrations (dev)
npx prisma migrate deploy     # Run pending migrations (production)
npm run dev                   # Start Next.js dev server (port 3000)
npm run worker                # Start background worker (separate terminal)
npm run build                 # Build for production
npm test                      # Run all tests (tsx --test)
npm run lint                  # Run ESLint
```

### Local Infrastructure
```bash
docker compose up -d          # Start Postgres, MinIO, lemma service
docker compose down           # Stop all services

# Create MinIO audio bucket (one-time setup):
docker run --rm --entrypoint sh minio/mc -c "mc alias set local http://host.docker.internal:9000 minioadmin minioadmin && mc mb -p local/duma-audio || true"
```

### GSE Data Management
```bash
npm run gse:import:github                      # Import GSE catalog from GitHub
npm run gse:import:official                    # Import from official GSE API
npm run gse:aliases:backfill                   # Backfill aliases for vocab nodes
npm run gse:embeddings:backfill -- --all       # Backfill embeddings (run after catalog updates)
npm run gse:qa                                 # Run GSE quality checks
```

### Debugging Scripts
```bash
npx tsx src/scripts/inspect_planner_flow.ts [studentId]         # Show planner pool, bundle nodes, recent decisions
npx tsx src/scripts/inspect_teacher_profile.ts [studentId]      # Explain readiness score, closed nodes, blocking nodes
npx tsx src/scripts/inspect_recent_tasks.ts                     # Show evidence by kind (direct/supporting/negative)
npx tsx src/scripts/inspect_last_attempt_nodes.ts [word]        # Show candidate readiness per node
npx tsx src/scripts/inspect_profile_evidence.ts [studentId]     # Evidence mix and streak analysis
npx tsx src/scripts/inspect_last_attempt_pipeline.ts            # Full pipeline trace (parser → retrieval → evaluator → evidence)
```

## Architecture

### Core Loop (Brain Pipeline)

1. **Planner** (`src/lib/gse/planner.ts`) selects target nodes from GSE mastery deficits, uncertainty, and overdue nodes. Returns `targetNodeIds` and `targetNodeDescriptors`.

2. **Task Generator** (`src/lib/taskGenerator.ts`) creates task specs from target node descriptors (human-readable objectives). LLM receives objectives, not raw IDs.

3. **Worker** (`src/worker/index.ts`) processes attempts asynchronously:
   - Speech analysis (Azure or mock)
   - Semantic LO/Grammar matching (parser LLM → embedding retrieval → evaluation LLM)
   - Vocabulary retrieval (lemmatization → stage-windowed index → evaluation LLM)
   - Task quality evaluation (`src/lib/evaluator.ts`)

4. **Evidence Pipeline** (`src/lib/gse/evidence.ts`) persists evidence rows (`AttemptGseEvidence`) with domain, kind, opportunity type, confidence, and reliability.

5. **Mastery Update** (`src/lib/gse/mastery.ts`) applies Bayesian posterior updates (alpha/beta) with:
   - Base weight = 1 for both direct and supporting evidence
   - Effective weight = baseWeight × conf × rel × PFA × streak
   - PFA-style modifiers: score ≥ 0.6 → ×1.1, score < 0.4 → ×0.9
   - Streak bonus: 2nd+ direct success in a row → ×1.15
   - Alpha/beta cap at 12 to prevent diminishing returns

6. **Stage Projection** (`src/lib/gse/stageProjection.ts`) recalculates:
   - `placementStage` (provisional, evidence-based)
   - `promotionStage` (bundle-gated, requires verified nodes with value ≥ 70)

### Domains and Evidence Types

**Domains:** `vocab`, `grammar`, `lo` (learning objectives)

**Evidence kinds:**
- `direct`: Target node was explicitly elicited in the task
- `supporting`: Incidental observation of target node (e.g., word used but task wasn't target_vocab for that word)
- `negative`: Opportunity provided but node not demonstrated

**Opportunity types:**
- `explicit_target`: Node was in task's target list
- `elicited_incidental`: Node was elicited by task structure but not an explicit target
- `incidental`: Spontaneous use, not elicited

### Node Lifecycle

1. **observed**: Incidental signals noticed (supporting + incidental opportunity)
2. **candidate_for_verification**: ≥3 incidental observations, ≥2 task types, median confidence ≥ 0.7
3. **verified**: Either (a) one direct evidence with score ≥ 0.7, confidence ≥ 0.75, explicit target; or (b) N-CCR early verification (2 direct successes in a row)

### Semantic Incidental Detection

**LO/Grammar matching** (`src/lib/gse/semanticAssessor.ts`):
1. Parser LLM extracts communicative intents + grammar patterns from transcript
2. Embedding retrieval ranks `GSE_LO` and `GSE_GRAMMAR` candidates in stage/audience window
3. Evaluation LLM receives shortlist + explicit task targets, produces `loChecks` and `grammarChecks`

**Vocabulary matching** (`src/lib/gse/vocabRetrieval.ts`):
1. Lemmatization (spaCy service if `LEMMA_SERVICE_URL` set, otherwise JS fallback)
2. Stage-windowed in-memory index matches lemma/surface n-grams to `GSE_VOCAB` aliases/descriptors
3. Evaluation LLM receives shortlist + explicit targets, produces `vocabChecks`

## Key Invariants

- No legacy skill-average path in decision loop
- No promotion by read-aloud lexical evidence alone
- No next task without node targets (`targetNodeIds`)
- Explainability emitted per decision and attempt
- LLM never evaluates against full catalog; only against retrieval shortlist + explicit task targets
- Types and domains come from schema/API/planner, never from text pattern matching

## Environment Variables

### Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Session encryption key
- `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`: Object storage (MinIO or R2)

### Speech Provider
- `SPEECH_PROVIDER`: `mock` or `azure`
- For Azure: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_ENDPOINT`, `AZURE_SPEECH_REGION`

### Semantic Pipeline (optional)
- `OPENAI_API_KEY`: Required for semantic LO/Grammar/Vocab evaluation
- `OPENAI_MODEL`: Default `gpt-4o-mini`
- `GSE_SEMANTIC_ENABLED`: Default `true`
- `GSE_SEMANTIC_CONF_THRESHOLD`: Default `0.68`
- `GSE_SEMANTIC_MAX_CANDIDATES`: Default `24`
- `GSE_EMBEDDING_MODEL`: Default `text-embedding-3-small`
- `GSE_PARSER_MODEL`: Default uses `OPENAI_MODEL`
- `GSE_VOCAB_CATALOGS`: Comma-separated (e.g., `gse_vocab_yl` to restrict incidental vocab indexing)
- `GSE_VOCAB_MAX_CANDIDATES`: Default `24`

### Lemma Service (optional)
- `LEMMA_SERVICE_URL`: Default none (uses JS fallback). Set to `http://localhost:8099` for spaCy.
- `LEMMA_SERVICE_TIMEOUT_MS`: Default `1200`

### LangSmith Debugging (optional)
- `LANGCHAIN_TRACING_V2=true`: Enable LangSmith tracing for LLM prompts/responses
- `LANGCHAIN_API_KEY`: Get from https://smith.langchain.com
- `LANGCHAIN_PROJECT`: Project name (e.g., `duma_english`)

### Pipeline Debugging (optional)
- `PIPELINE_DEBUG_LOG_ENABLED=true`: Write NDJSON events to log file
- `PIPELINE_DEBUG_LOG_PATH`: Default `tmp/pipeline-debug.ndjson`

## Testing

Run tests before committing:
```bash
npm test          # All tests
npm run lint      # Linting
npm run build     # Production build
```

When fixing bugs, re-run one real attempt and inspect evidence + node outcomes.

## Database Schema

Key models (`prisma/schema.prisma`):
- **Teacher**, **Class**, **ClassCode**, **Student**: Teacher/student authentication and class management
- **Task**, **TaskInstance**, **TaskGseTarget**: Task templates and explicit node targets
- **Attempt**, **AttemptGseEvidence**: Student attempts and evidence rows
- **StudentGseMastery**: Per-node Bayesian mastery state (alpha, beta, decayedMastery, activationState, spacingStateJson)
- **GseStageProjection**: Student stage (placementStage, promotionStage)
- **PlannerDecisionLog**: Planner decisions and reasoning
- **GseNode**, **GseNodeEmbedding**: GSE catalog and embeddings

## Authoritative Docs

For deep context, always consult:
- `TASKS.MD`: Single source of truth for product goals, runtime state, open gaps, sprint plans
- `docs/BRAIN_RUNTIME.md`: Core loop, evidence policy, node lifecycle, key invariants
- `docs/DEBUG_PLAYBOOK.md`: Debugging guides, common issues, inspection scripts
- `docs/EVAL_SPLIT_PLAN.md`: Evaluation split by domain (LO/Grammar/Vocab)
- `.cursor/rules/no-kludges.mdc`: Anti-pattern rules (no text-based type guessing, one source of truth)

## Code Style

- Avoid over-engineering: Only make changes that are directly requested or clearly necessary.
- No backwards-compatibility hacks (unused `_vars`, re-exporting types, `// removed` comments). Delete unused code completely.
- No magic strings or constants for business logic. Use explicit types/fields from models.
- Validation at system boundaries only (user input, external APIs). Trust internal code and framework guarantees.
- Don't add features, refactor code, or make "improvements" beyond what was asked.
- Don't add error handling, fallbacks, or validation for scenarios that can't happen.
- Don't create helpers, utilities, or abstractions for one-time operations.
