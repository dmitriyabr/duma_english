/**
 * Достоверные данные по последней попытке: из БД и из pipeline-debug.ndjson.
 * Без «вроде» — только то, что реально записано.
 * Запуск: npx tsx src/scripts/inspect_last_attempt_factual.ts
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/db";

const DEBUG_LOG_PATH = process.env.PIPELINE_DEBUG_LOG_PATH?.trim() || path.join(process.cwd(), "tmp", "pipeline-debug.ndjson");

async function readLastPipelineEvents() {
  let raw: string;
  try {
    raw = await readFile(DEBUG_LOG_PATH, "utf8");
  } catch {
    return null;
  }
  const lines = raw.trim().split("\n").filter(Boolean);
  const byType: Record<string, unknown> = {};
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as { event: string; [k: string]: unknown };
      byType[obj.event] = obj;
    } catch {
      // skip
    }
  }
  return {
    semanticQueries: byType["semantic_retrieval_queries"] as { loQueries?: string[]; grammarQueries?: string[]; taskType?: string } | undefined,
    semanticCandidates: byType["semantic_retrieval_candidates"] as { loCandidates?: Array<{ nodeId: string; descriptor: string; sourceKey: string; score?: number }>; grammarCandidates?: Array<{ nodeId: string; descriptor: string; sourceKey: string; score?: number }>; taskType?: string } | undefined,
    vocabPhraseCandidates: byType["vocab_retrieval_phrase_candidates"] as { top?: string[]; candidateCount?: number; taskType?: string; runId?: string } | undefined,
    vocabCandidates: byType["vocab_retrieval_candidates"] as { top?: Array<{ nodeId: string; descriptor: string; retrievalScore?: number; matchedPhrases?: string[] }>; candidateCount?: number; taskType?: string; runId?: string; transcriptPreview?: string } | undefined,
  };
}

async function main() {
  const attempt = await prisma.attempt.findFirst({
    where: { status: "completed" },
    orderBy: { completedAt: "desc" },
    include: {
      task: {
        include: {
          gseTargets: {
            include: {
              node: { select: { nodeId: true, type: true, sourceKey: true, descriptor: true } },
            },
          },
        },
      },
      student: { select: { displayName: true } },
      gseEvidence: true,
    },
  });

  if (!attempt) {
    console.log("Нет завершённых попыток в БД.");
    return;
  }

  const task = attempt.task as { id: string; type: string; prompt: string; gseTargets: Array<{ nodeId: string; node: { nodeId: string; type: string; sourceKey: string; descriptor: string } }> } | null;
  const taskType = task?.type ?? "";
  const evalJson = (attempt.taskEvaluationJson || {}) as {
    loChecks?: Array<{ checkId: string; nodeId?: string; label: string; pass: boolean; confidence: number; severity?: string; evidenceSpan?: string }>;
    grammarChecks?: Array<{ checkId?: string; descriptorId?: string; label: string; pass: boolean; confidence: number; opportunityType?: string; evidenceSpan?: string }>;
    vocabChecks?: Array<{ nodeId: string; label: string; pass: boolean; confidence: number; opportunityType?: string; evidenceSpan?: string; matchedPhrase?: string }>;
    taskScore?: number;
    taskType?: string;
  };
  const pipeline = await readLastPipelineEvents();

  const logTaskMatch = pipeline?.semanticQueries?.taskType === taskType || pipeline?.vocabCandidates?.taskType === taskType;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("ПОСЛЕДНЯЯ ПОПЫТКА (достоверные данные из БД)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Attempt id:", attempt.id);
  console.log("Task id:", task?.id);
  console.log("Task type:", taskType);
  console.log("Student:", (attempt.student as { displayName?: string })?.displayName ?? attempt.studentId);
  console.log("Completed:", attempt.completedAt?.toISOString() ?? "—");
  console.log("Task score:", evalJson.taskScore ?? "—");
  console.log("\nТранскрипт (полностью из БД):");
  console.log(attempt.transcript || "(пусто)");

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 1. ЯВНЫЕ ТАРГЕТЫ ЗАДАНИЯ (из БД: TaskGseTarget)");
  console.log("═══════════════════════════════════════════════════════════════");
  const targets = task?.gseTargets ?? [];
  for (const t of targets) {
    const n = t.node as { nodeId: string; type: string; sourceKey: string; descriptor: string };
    console.log(`  nodeId: ${n.nodeId}`);
    console.log(`  type: ${n.type}  descriptor: "${n.descriptor}"`);
  }
  if (targets.length === 0) console.log("  (нет записей)");

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 2. ВЫХОД ПАРСЕРА (из pipeline-debug.ndjson, последнее событие semantic_retrieval_queries)");
  console.log("═══════════════════════════════════════════════════════════════");
  if (!pipeline?.semanticQueries) {
    console.log("  В логе нет semantic_retrieval_queries (включи PIPELINE_DEBUG_LOG_ENABLED и перезапусти worker перед следующей попыткой).");
  } else {
    if (!logTaskMatch) console.log("  (Внимание: taskType в логе не совпадает с попыткой — события могли быть от другой попытки.)\n");
    const loQueries = pipeline.semanticQueries.loQueries ?? [];
    const grammarQueries = pipeline.semanticQueries.grammarQueries ?? [];
    console.log("  LO intents (как передано в retrieval, строго из парсера):");
    for (const q of loQueries) {
      const label = q.replace(/^LO intent: /, "");
      console.log(`    - "${label}"`);
    }
    console.log("  Grammar patterns (строго из парсера):");
    for (const q of grammarQueries) {
      console.log(`    - "${q}"`);
    }
    if (loQueries.length === 0 && grammarQueries.length === 0) console.log("  (пусто)");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 3. КАНДИДАТЫ LO И GRAMMAR (из pipeline-debug.ndjson, semantic_retrieval_candidates)");
  console.log("═══════════════════════════════════════════════════════════════");
  if (!pipeline?.semanticCandidates) {
    console.log("  В логе нет semantic_retrieval_candidates.");
  } else {
    const loC = pipeline.semanticCandidates.loCandidates ?? [];
    const grC = pipeline.semanticCandidates.grammarCandidates ?? [];
    console.log("  loCandidates (топ-12, как передано в LLM):");
    for (const c of loC) {
      console.log(`    nodeId: ${c.nodeId}  score: ${c.score ?? "—"}  descriptor: "${(c.descriptor ?? "").slice(0, 80)}"`);
    }
    console.log("  grammarCandidates (топ-12):");
    for (const c of grC) {
      console.log(`    nodeId: ${c.nodeId}  sourceKey: ${c.sourceKey}  score: ${c.score ?? "—"}  descriptor: "${(c.descriptor ?? "").slice(0, 80)}"`);
    }
    if (loC.length === 0 && grC.length === 0) console.log("  (пусто)");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 4. ФРАЗЫ И КАНДИДАТЫ VOCAB (из pipeline-debug.ndjson)");
  console.log("═══════════════════════════════════════════════════════════════");
  if (!pipeline?.vocabPhraseCandidates && !pipeline?.vocabCandidates) {
    console.log("  В логе нет событий vocab_retrieval_*.");
  } else {
    if (pipeline.vocabPhraseCandidates) {
      console.log("  vocab_retrieval_phrase_candidates.top (фразы из твоего транскрипта, по которым искали в индексе):");
      const top = (pipeline.vocabPhraseCandidates.top ?? []) as string[];
      for (const p of top) console.log(`    "${p}"`);
      console.log("  candidateCount:", pipeline.vocabPhraseCandidates.candidateCount ?? "—");
    }
    if (pipeline.vocabCandidates) {
      console.log("\n  vocab_retrieval_candidates.top (кандидаты нод, попавшие в LLM):");
      const top = (pipeline.vocabCandidates.top ?? []) as Array<{ nodeId: string; descriptor: string; retrievalScore?: number; matchedPhrases?: string[] }>;
      for (const c of top) {
        console.log(`    nodeId: ${c.nodeId}  retrievalScore: ${c.retrievalScore ?? "—"}  descriptor: "${(c.descriptor ?? "").slice(0, 60)}"  matchedPhrases: ${JSON.stringify(c.matchedPhrases ?? [])}`);
      }
      console.log("  candidateCount:", pipeline.vocabCandidates.candidateCount ?? "—");
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 5. ЧЕКИ ОТ LLM (из БД: taskEvaluationJson)");
  console.log("═══════════════════════════════════════════════════════════════");
  const loChecks = evalJson.loChecks ?? [];
  const grammarChecks = evalJson.grammarChecks ?? [];
  const vocabChecks = evalJson.vocabChecks ?? [];
  console.log("  loChecks:");
  for (const c of loChecks) {
    console.log(`    checkId: ${c.checkId}  nodeId: ${c.nodeId ?? "—"}  label: "${(c.label ?? "").slice(0, 70)}"  pass: ${c.pass}  confidence: ${c.confidence}  evidenceSpan: "${(c.evidenceSpan ?? "").slice(0, 60)}"`);
  }
  console.log("  grammarChecks:");
  for (const c of grammarChecks) {
    console.log(`    descriptorId: ${(c as { descriptorId?: string }).descriptorId ?? "—"}  label: "${(c.label ?? "").slice(0, 70)}"  pass: ${c.pass}  confidence: ${c.confidence}  opportunityType: ${(c as { opportunityType?: string }).opportunityType ?? "—"}  evidenceSpan: "${((c as { evidenceSpan?: string }).evidenceSpan ?? "").slice(0, 60)}"`);
  }
  console.log("  vocabChecks:");
  for (const c of vocabChecks) {
    console.log(`    nodeId: ${c.nodeId}  label: "${(c.label ?? "").slice(0, 50)}"  pass: ${c.pass}  confidence: ${c.confidence}  opportunityType: ${c.opportunityType ?? "—"}  evidenceSpan: "${(c.evidenceSpan ?? "").slice(0, 50)}"`);
  }
  if (loChecks.length === 0 && grammarChecks.length === 0 && vocabChecks.length === 0) console.log("  (пусто)");

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 6. ЗАПИСАННЫЕ EVIDENCE (из БД: AttemptGseEvidence)");
  console.log("═══════════════════════════════════════════════════════════════");
  const evidence = attempt.gseEvidence ?? [];
  for (const e of evidence) {
    console.log(`  nodeId: ${e.nodeId}`);
    console.log(`    domain: ${e.domain}  signalType: ${e.signalType}  evidenceKind: ${e.evidenceKind}  opportunityType: ${e.opportunityType}`);
    console.log(`    targeted: ${e.targeted}  usedForPromotion: ${e.usedForPromotion}  source: ${e.source}`);
    console.log(`    confidence: ${e.confidence}  score: ${e.score}`);
    console.log(`    evidenceText: "${(e.evidenceText ?? "").slice(0, 100)}"`);
  }
  if (evidence.length === 0) console.log("  (нет записей)");

  console.log("\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
