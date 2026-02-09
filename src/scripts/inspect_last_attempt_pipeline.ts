/**
 * Разбор последней попытки по этапам: таргеты → чеки из LLM → записанные evidence.
 * Запуск: npx tsx src/scripts/inspect_last_attempt_pipeline.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";

type LoCheck = { checkId: string; nodeId?: string; label: string; pass: boolean; confidence: number; severity?: string; evidenceSpan?: string };
type GrammarCheck = { checkId: string; descriptorId?: string; label: string; pass: boolean; confidence: number; opportunityType?: string; evidenceSpan?: string };
type VocabCheck = { nodeId: string; label: string; pass: boolean; confidence: number; opportunityType?: string; evidenceSpan?: string; matchedPhrase?: string };
type TaskEvaluationJson = {
  loChecks?: LoCheck[];
  grammarChecks?: GrammarCheck[];
  vocabChecks?: VocabCheck[];
  taskScore?: number;
  taskType?: string;
};

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
      student: { select: { id: true, displayName: true } },
      gseEvidence: true,
    },
  });

  if (!attempt) {
    console.log("Нет завершённых попыток в БД.");
    return;
  }

  const task = attempt.task as { id: string; type: string; prompt: string } | null;
  const evalJson = (attempt.taskEvaluationJson || {}) as TaskEvaluationJson;
  const loChecks = evalJson.loChecks ?? [];
  const grammarChecks = evalJson.grammarChecks ?? [];
  const vocabChecks = evalJson.vocabChecks ?? [];

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("ПОСЛЕДНЯЯ ПОПЫТКА");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Attempt id:", attempt.id);
  console.log("Student:", (attempt.student as { displayName?: string })?.displayName ?? attempt.studentId);
  console.log("Completed:", attempt.completedAt?.toISOString() ?? "—");
  console.log("Task type:", task?.type ?? "—");
  console.log("Task score:", evalJson.taskScore ?? "—");
  console.log("\nTranscript (first 400 chars):");
  console.log((attempt.transcript || "(empty)").slice(0, 400));
  if ((attempt.transcript || "").length > 400) console.log("...");

  // Stage 1: явные таргеты задания (из планировщика)
  const taskWithTargets = attempt.task as { id: string; type: string; prompt: string; gseTargets?: Array<{ nodeId: string; node: { nodeId: string; type: string; sourceKey: string; descriptor: string } }> } | null;
  const targets = taskWithTargets?.gseTargets ?? [];
  const targetByType = { GSE_LO: [] as typeof targets, GSE_GRAMMAR: [] as typeof targets, GSE_VOCAB: [] as typeof targets };
  for (const t of targets) {
    const type = (t.node as { type: string })?.type;
    if (type === "GSE_LO") targetByType.GSE_LO.push(t);
    else if (type === "GSE_GRAMMAR") targetByType.GSE_GRAMMAR.push(t);
    else if (type === "GSE_VOCAB") targetByType.GSE_VOCAB.push(t);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 1: ЯВНЫЕ ТАРГЕТЫ ЗАДАНИЯ (TaskGseTarget)");
  console.log("Откуда: планировщик выбрал эти ноды для этого задания.");
  console.log("═══════════════════════════════════════════════════════════════");
  for (const t of targets) {
    const n = t.node as { nodeId: string; type: string; sourceKey: string; descriptor: string };
    console.log(`  [${n.type}] ${n.nodeId}`);
    console.log(`    descriptor: ${(n.descriptor || "").slice(0, 100)}`);
  }
  if (targets.length === 0) console.log("  (нет таргетов)");

  // Stage 2: retrieval — в БД не хранится, только в pipeline debug log при включённом PIPELINE_DEBUG_LOG_ENABLED
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 2: КАНДИДАТЫ RETRIEVAL (в БД не сохраняются)");
  console.log("Как получаются:");
  console.log("  • LO/Grammar: парсер LLM → метки → эмбеддинги запросов → cosine с GSE_LO/GSE_GRAMMAR в окне stage → топ ~24.");
  console.log("  • Vocab: лемматизация → n-граммы → индекс по дескрипторам/алиасам GSE_VOCAB → топ ~24.");
  console.log("Чтобы увидеть кандидатов по этой попытке: включите PIPELINE_DEBUG_LOG_ENABLED=true и перезапустите worker.");
  console.log("═══════════════════════════════════════════════════════════════");

  // Stage 3: вывод LLM — loChecks, grammarChecks, vocabChecks
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 3: ЧЕКИ ОТ EVALUATION LLM (taskEvaluationJson)");
  console.log("Модель получила таргеты + короткий список кандидатов (retrieval) и вернула эти проверки.");
  console.log("═══════════════════════════════════════════════════════════════");

  console.log("\n--- loChecks (checkId = nodeId из вариантов) ---");
  for (const c of loChecks) {
    const nodeId = (c as LoCheck).nodeId ?? (c as LoCheck).checkId;
    console.log(`  checkId/nodeId: ${nodeId}`);
    console.log(`    label: ${(c.label || "").slice(0, 90)}`);
    console.log(`    pass=${c.pass} confidence=${c.confidence} severity=${c.severity ?? "—"}`);
    if ((c as LoCheck).evidenceSpan) console.log(`    evidenceSpan: ${String((c as LoCheck).evidenceSpan).slice(0, 80)}`);
  }
  if (loChecks.length === 0) console.log("  (нет)");
  const loCheckIdsAreGse = loChecks.some((c) => String((c as LoCheck).checkId ?? (c as LoCheck).nodeId ?? "").startsWith("gse:"));
  if (loChecks.length > 0 && !loCheckIdsAreGse) {
    console.log("  (checkId не в формате gse:... — для этого типа задания LLM вернул рубричные чеки, не GSE_LO nodeId; LO evidence по ним не пишется)");
  }

  console.log("\n--- grammarChecks (descriptorId = sourceKey грамматической ноды) ---");
  for (const c of grammarChecks) {
    console.log(`  descriptorId: ${(c as GrammarCheck).descriptorId ?? "—"}`);
    console.log(`    label: ${(c.label || "").slice(0, 90)}`);
    console.log(`    pass=${c.pass} confidence=${c.confidence} opportunityType=${(c as GrammarCheck).opportunityType ?? "—"}`);
    if ((c as GrammarCheck).evidenceSpan) console.log(`    evidenceSpan: ${String((c as GrammarCheck).evidenceSpan).slice(0, 80)}`);
  }
  if (grammarChecks.length === 0) console.log("  (нет)");

  console.log("\n--- vocabChecks ---");
  for (const c of vocabChecks) {
    console.log(`  nodeId: ${(c as VocabCheck).nodeId}`);
    console.log(`    label: ${(c.label || "").slice(0, 90)}`);
    console.log(`    pass=${c.pass} confidence=${c.confidence} opportunityType=${(c as VocabCheck).opportunityType ?? "—"}`);
    if ((c as VocabCheck).matchedPhrase) console.log(`    matchedPhrase: ${(c as VocabCheck).matchedPhrase}`);
    if ((c as VocabCheck).evidenceSpan) console.log(`    evidenceSpan: ${String((c as VocabCheck).evidenceSpan).slice(0, 80)}`);
  }
  if (vocabChecks.length === 0) console.log("  (нет)");

  // Stage 4: записанные evidence
  const evidence = attempt.gseEvidence ?? [];
  const evidenceByDomain = { lo: [] as typeof evidence, grammar: [] as typeof evidence, vocab: [] as typeof evidence };
  for (const e of evidence) {
    if (e.domain === "lo") evidenceByDomain.lo.push(e);
    else if (e.domain === "grammar") evidenceByDomain.grammar.push(e);
    else if (e.domain === "vocab") evidenceByDomain.vocab.push(e);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ЭТАП 4: ЗАПИСАННЫЕ EVIDENCE (AttemptGseEvidence)");
  console.log("По чекам и таргетам buildOpportunityEvidence создал эти строки.");
  console.log("═══════════════════════════════════════════════════════════════");
  for (const e of evidence) {
    console.log(`  nodeId: ${e.nodeId}`);
    console.log(`    domain=${e.domain} signalType=${e.signalType} evidenceKind=${e.evidenceKind} opportunityType=${e.opportunityType}`);
    console.log(`    targeted=${e.targeted} usedForPromotion=${e.usedForPromotion} source=${e.source}`);
    console.log(`    confidence=${e.confidence} score=${e.score}`);
    if (e.evidenceText) console.log(`    evidenceText: ${e.evidenceText.slice(0, 100)}`);
  }
  if (evidence.length === 0) console.log("  (нет записей)");

  // Сводка: откуда каждая evidence (дедуп по nodeId + signalType + opportunityType)
  const seen = new Set<string>();
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("СВОДКА: КАК НОДА ПОПАЛА В EVIDENCE");
  console.log("═══════════════════════════════════════════════════════════════");
  for (const e of evidence) {
    const key = `${e.nodeId}|${e.signalType}|${e.opportunityType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fromTarget = targets.some((t) => (t.node as { nodeId: string }).nodeId === e.nodeId);
    const fromLo = loChecks.some((c) => ((c as LoCheck).nodeId ?? (c as LoCheck).checkId) === e.nodeId && String((c as LoCheck).checkId).startsWith("gse:"));
    const fromVocab = vocabChecks.some((c) => (c as VocabCheck).nodeId === e.nodeId);
    let origin = "?";
    if (e.targeted && fromTarget && e.signalType?.includes("used")) origin = "явный таргет (TaskGseTarget) → совпадение по лемме/слову в транскрипте → evidence";
    else if (e.targeted && fromTarget) origin = "явный таргет → evidence";
    else if (e.domain === "lo" && fromLo) origin = "retrieval → loCandidates → LLM loCheck (nodeId) → evidence";
    else if (e.domain === "grammar") origin = "retrieval → grammarCandidates → LLM grammarCheck (descriptorId) → по sourceKey найден nodeId → evidence";
    else if (e.domain === "vocab" && fromVocab) origin = "retrieval → vocab candidates → LLM vocabCheck → evidence";
    else if (e.domain === "vocab" && e.signalType === "vocab_incidental_discovery") origin = "vocab: леммы/фразы транскрипта совпали с алиасами в индексе (discovery) → evidence";
    else if (e.domain === "vocab") origin = "vocab: таргет или discovery";
    else origin = "retrieval → candidate → LLM check → evidence";
    console.log(`  ${e.nodeId} (${e.domain}, ${e.signalType}): ${origin}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
