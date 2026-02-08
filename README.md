# Duma Speaking Trainer (MVP)

Web MVP for an AI speaking trainer: student login via personal code (from teacher), record speech, async analysis, feedback, and progress.

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

## Lemma service (spaCy)

For higher-quality vocabulary matching, the app can call a small Python spaCy lemmatization service.

The service is included in `docker compose up -d` by default.

1. Start local infra (includes lemma service): `docker compose up -d`
2. In `.env` set: `LEMMA_SERVICE_URL=http://localhost:8099`
3. Restart `npm run dev` / `npm run worker`

Note: On Apple Silicon (Docker `linux/arm64`) spaCy may compile from source during the image build, which can take a few minutes.

If `LEMMA_SERVICE_URL` is not set (or the service is down), the app falls back to a lightweight JS lemmatizer.

## Teacher flow

1. Open `/teacher` (or `/teacher/login`) and sign up (email, password, name) or sign in.
2. On the dashboard, create a class and open it.
3. Add students by name; each gets a **personal code** (shown after add and in the table). Give that code to the student.
4. Students use only their **personal code** on `/login` (and age group); they always return to the same profile. Teacher sees students and profiles (progress, GSE nodes) on the class page and via Profile per student.

(Optional: `/admin` with basic auth still exists for legacy “create class + generate code” without teacher account.)

## MVP flow (student)

1. Student opens `/login`
2. Enters their **personal code** (from teacher) and age group
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

## Vocabulary (Incidental Evidence)

Vocabulary incidental selection is lexical-first:

1. Lemmatization: transcript is lemmatized (spaCy if available, otherwise fallback JS).
2. Stage index: we build an in-memory index of `GSE_VOCAB` aliases/descriptors in a stage/audience window.
3. Candidate generation: lemma/surface n-grams are matched to the index to produce a small candidate list.
4. Evaluation LLM: receives only the shortlisted vocab options (and any explicit vocab targets) and returns `vocabChecks`.
5. Evidence pipeline: `vocabChecks` produce incidental vocab evidence rows (`targeted=false`).

### Target nodes (explicit tasks)

Each task has `TaskGseTarget` rows (node targets selected by the planner). The worker passes these targets into evaluation so the model:
- always evaluates the explicit target nodes for the task (not only incidental nodes),
- marks target grammar checks as `opportunityType=explicit_target`.

Note: `GSE_VOCAB_CATALOGS` affects *incidental vocab retrieval* (the in-memory index). It does not currently restrict which `GSE_VOCAB` nodes the planner can select as explicit task targets, so you may see targets from other catalogs (e.g. `gse_vocab_ssgl`) depending on what is in the database.

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
  - `LEMMA_SERVICE_URL` (optional, enables spaCy lemmatization)
  - `LEMMA_SERVICE_TIMEOUT_MS` (default: `1200`)
  - `GSE_VOCAB_CATALOGS` (optional, comma-separated; e.g. `gse_vocab_yl` to avoid duplicate catalogs)
  - `GSE_VOCAB_INDEX_TTL_MS` (default: `600000`)
  - `GSE_VOCAB_MAX_CANDIDATES` (default: `24`)

## Brain docs (current truth)

- `TASKS.MD`
- `docs/BRAIN_RUNTIME.md`
- `docs/BRAIN_ROADMAP.md`
- `docs/DEBUG_PLAYBOOK.md`
- `docs/TEACHER_STUDENT_UI_PLAN.md` — план интерфейса учителя и ученика (ветка `feature/teacher-student-ui`)
