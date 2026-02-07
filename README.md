# Duma Speaking Trainer (MVP)

Web MVP for an AI speaking trainer: student login via class code, record speech, async analysis, feedback, and progress.

## Quick start

1. Copy `.env.example` to `.env` and fill values.
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

## Brain docs (current truth)

- `/Users/skyeng/Desktop/duma_english/TASKS.MD`
- `/Users/skyeng/Desktop/duma_english/docs/BRAIN_RUNTIME.md`
- `/Users/skyeng/Desktop/duma_english/docs/BRAIN_ROADMAP.md`
- `/Users/skyeng/Desktop/duma_english/docs/DEBUG_PLAYBOOK.md`
