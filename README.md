# Duma Speaking Trainer (MVP)

Web MVP for an AI speaking trainer: student login via class code, record speech, async analysis, feedback, and progress.

## Quick start

1. Create `.env` (see required vars below).
2. Install dependencies: `npm install`
3. Generate Prisma client: `npx prisma generate`
4. Run migrations (first time): `npx prisma migrate dev --name init`
5. Run tests: `npm test`
6. Start Next dev server: `npm run dev`
7. Start worker (separate terminal): `npm run worker`

## Local infra (Postgres + MinIO)

1. Start services: `docker compose up -d`
2. Create audio bucket:
`docker run --rm --entrypoint sh minio/mc -c "mc alias set local http://host.docker.internal:9000 minioadmin minioadmin && mc mb -p local/duma-audio || true"`
3. Stop services when done: `docker compose down`

## Admin setup

Admin endpoints are protected by basic auth.

- Set `ADMIN_USER` and `ADMIN_PASS`
- Open `/admin` in the browser
- Create a class and generate a class code

## MVP flow

1. Student opens `/login`
2. Enters class code + name
3. Receives a task at `/task`
4. Records audio at `/record`
5. Results show at `/results`

## Notes

- Audio is deleted immediately after processing.
- `SPEECH_PROVIDER=mock` uses mock analysis.
- To enable Azure speech, set:
  - `SPEECH_PROVIDER=azure`
  - `AZURE_SPEECH_KEY`
  - `AZURE_SPEECH_ENDPOINT`
  - `AZURE_SPEECH_REGION`

## Semantic LO/Grammar (Incidental Evidence)

The worker can detect and score incidental `GSE_LO` and `GSE_GRAMMAR` nodes from a student's transcript using:

1. Parser LLM: extracts communicative intents + grammar patterns.
2. Embedding retrieval: ranks candidate nodes within stage/audience window.
3. Evaluation LLM: receives only the shortlisted LO/grammar options and produces structured `loChecks` / `grammarChecks` used by the evidence pipeline.

This is optional and is disabled if `OPENAI_API_KEY` is not set.

### Target nodes (explicit tasks)

Each task has `TaskGseTarget` rows (node targets selected by the planner). The worker passes these targets into evaluation so the model:
- always evaluates the explicit target nodes for the task (not only incidental nodes),
- marks target grammar checks as `opportunityType=explicit_target`.

### Embeddings backfill

Embeddings are cached in Postgres (`GseNodeEmbedding`). For production-like usage, run a backfill after importing/updating the GSE catalog:

`npm run gse:embeddings:backfill -- --all`

### Env vars

- Required to enable semantic pipeline:
  - `OPENAI_API_KEY`
- Optional controls:
  - `GSE_SEMANTIC_ENABLED` (default: `true`)
  - `GSE_SEMANTIC_CONF_THRESHOLD` (default: `0.68`)
  - `GSE_SEMANTIC_MAX_CANDIDATES` (default: `24`)
  - `GSE_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
  - `GSE_PARSER_MODEL` (default: `OPENAI_MODEL` or `gpt-4.1-mini`)
  - `GSE_ASSESSOR_MODEL` (default: `OPENAI_MODEL` or `gpt-4.1-mini`)

## Brain docs (current truth)

- `TASKS.md`
- `docs/BRAIN_RUNTIME.md`
- `docs/BRAIN_ROADMAP.md`
- `docs/DEBUG_PLAYBOOK.md`
