/**
 * Debug replay script for placement extended evaluation pipeline.
 *
 * Usage:
 *   npx tsx src/scripts/debug_placement_eval.ts <attemptId>
 *
 * Loads the attempt from DB, re-runs semantic + vocab retrieval and all three
 * evaluator LLM calls, then prints candidates, evaluator results, and a diff
 * against the stored AttemptGseEvidence rows.
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { buildSemanticEvaluationContext } from "../lib/gse/semanticAssessor";
import { buildVocabEvaluationContext } from "../lib/gse/vocabRetrieval";
import { evaluateLoOnly, evaluateGrammarOnly, evaluateVocabOnly } from "../lib/evaluator";
import type { EvaluationInput } from "../lib/evaluator";

function heading(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function table(rows: Array<Record<string, unknown>>, keys: string[]) {
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const row of rows) {
    const parts = keys.map((k) => {
      const v = row[k];
      if (typeof v === "number") return `${k}=${Number(v.toFixed(3))}`;
      if (typeof v === "boolean") return `${k}=${v}`;
      return `${k}=${String(v ?? "").slice(0, 60)}`;
    });
    console.log(`  ${parts.join("  ")}`);
  }
}

async function main() {
  const attemptId = process.argv[2];
  if (!attemptId) {
    console.error("Usage: npx tsx src/scripts/debug_placement_eval.ts <attemptId>");
    process.exit(1);
  }

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      task: {
        include: {
          gseTargets: {
            include: {
              node: {
                select: { nodeId: true, type: true, sourceKey: true, descriptor: true, gseCenter: true },
              },
            },
          },
        },
      },
      gseEvidence: {
        include: {
          node: { select: { nodeId: true, type: true, descriptor: true, gseCenter: true } },
        },
      },
    },
  });

  if (!attempt) {
    console.error(`Attempt ${attemptId} not found`);
    process.exit(1);
  }

  heading("ATTEMPT INFO");
  console.log(`  id:         ${attempt.id}`);
  console.log(`  studentId:  ${attempt.studentId}`);
  console.log(`  taskType:   ${attempt.task.type}`);
  console.log(`  status:     ${attempt.status}`);
  console.log(`  transcript: ${(attempt.transcript || "").slice(0, 200)}...`);
  const meta = (attempt.task.metaJson ?? {}) as Record<string, unknown>;
  console.log(`  taskMeta:   ${JSON.stringify(meta).slice(0, 200)}`);

  const isPlacement = meta.placementMode === "placement_extended";
  const stage = isPlacement ? "B1" : (typeof meta.stage === "string" ? meta.stage : "A2");
  const ageBand = typeof meta.ageBand === "string" ? meta.ageBand : null;

  heading("TASK TARGETS");
  for (const t of attempt.task.gseTargets) {
    console.log(`  ${t.node.type.padEnd(12)} ${t.nodeId.slice(0, 20).padEnd(22)} gse=${t.node.gseCenter ?? "?"} ${t.node.descriptor.slice(0, 80)}`);
  }

  // --- Retrieval ---
  heading("SEMANTIC RETRIEVAL (LO + Grammar)");
  const semanticCtx = await buildSemanticEvaluationContext({
    transcript: attempt.transcript || "",
    taskPrompt: attempt.task.prompt,
    taskType: attempt.task.type,
    stage,
    ageBand,
  });

  console.log("\n  LO candidates (top 12):");
  table(
    semanticCtx.loCandidates.slice(0, 12).map((c) => ({ ...c })),
    ["nodeId", "descriptor", "retrievalScore"]
  );
  console.log("\n  Grammar candidates (top 12):");
  table(
    semanticCtx.grammarCandidates.slice(0, 12).map((c) => ({ ...c })),
    ["sourceKey", "descriptor", "retrievalScore"]
  );

  heading("VOCAB RETRIEVAL (allCatalogs=true)");
  const vocabCtx = await buildVocabEvaluationContext({
    transcript: attempt.transcript || "",
    stage,
    ageBand,
    taskType: attempt.task.type,
    runId: attempt.id,
    allCatalogs: true,
  });
  console.log(`  debug: ${JSON.stringify(vocabCtx.debug)}`);
  console.log(`\n  Vocab candidates (top 15):`);
  table(
    vocabCtx.candidates.slice(0, 15).map((c) => ({ ...c, matchedPhrases: c.matchedPhrases.join(", ") })),
    ["nodeId", "descriptor", "retrievalScore", "matchedPhrases"]
  );

  // --- Evaluator LLM calls ---
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("\nOPENAI_API_KEY not set — skipping evaluator calls.");
    return;
  }
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const taskTargets = attempt.task.gseTargets.map((t) => ({
    nodeId: t.nodeId,
    weight: t.weight,
    required: t.required,
    node: t.node as { nodeId: string; type: "GSE_LO" | "GSE_VOCAB" | "GSE_GRAMMAR"; sourceKey: string; descriptor: string },
  }));

  const evalInput: EvaluationInput = {
    taskId: attempt.task.id,
    taskType: attempt.task.type,
    taskPrompt: attempt.task.prompt,
    transcript: attempt.transcript || "",
    speechMetrics: ((attempt as Record<string, unknown>).speechMetricsJson ?? {}) as EvaluationInput["speechMetrics"],
    taskMeta: meta,
    taskTargets,
  };

  const targetLoOptions = taskTargets
    .filter((t) => t.node.type === "GSE_LO")
    .map((t) => ({ nodeId: t.nodeId, label: t.node.descriptor.slice(0, 140) }));
  const targetGrammarOptions = taskTargets
    .filter((t) => t.node.type === "GSE_GRAMMAR")
    .map((t) => ({ descriptorId: t.node.sourceKey, label: t.node.descriptor.slice(0, 140) }));
  const targetVocabOptions = taskTargets
    .filter((t) => t.node.type === "GSE_VOCAB")
    .map((t) => ({ nodeId: t.nodeId, label: t.node.descriptor.slice(0, 140) }));

  const targetLoNodeIds = new Set(targetLoOptions.map((t) => t.nodeId));
  const targetGrammarDescriptorIds = new Set(targetGrammarOptions.map((t) => t.descriptorId));
  const targetVocabNodeIds = new Set(targetVocabOptions.map((t) => t.nodeId));

  const loOptions = semanticCtx.loCandidates
    .filter((c) => !targetLoNodeIds.has(c.nodeId))
    .slice(0, 30)
    .map((c) => ({ nodeId: c.nodeId, label: c.descriptor.slice(0, 140) }));
  const grammarOptions = semanticCtx.grammarCandidates
    .filter((c) => !targetGrammarDescriptorIds.has(c.sourceKey))
    .slice(0, 25)
    .map((c) => ({ descriptorId: c.sourceKey, label: c.descriptor.slice(0, 140) }));
  const vocabOptions = vocabCtx.candidates
    .filter((c) => !targetVocabNodeIds.has(c.nodeId))
    .slice(0, 35)
    .map((c) => ({
      nodeId: c.nodeId,
      label: c.descriptor.slice(0, 140),
      topicHints: c.topicHints?.slice(0, 2),
      grammaticalCategories: c.grammaticalCategories?.slice(0, 2),
    }));

  heading("EVALUATOR LLM CALLS");
  const [loChecks, grammarChecks, vocabChecks] = await Promise.all([
    evaluateLoOnly(apiKey, model, evalInput, targetLoOptions, loOptions),
    evaluateGrammarOnly(apiKey, model, evalInput, targetGrammarOptions, grammarOptions, targetGrammarDescriptorIds),
    evaluateVocabOnly(apiKey, model, evalInput, targetVocabOptions, vocabOptions, targetVocabNodeIds),
  ]);

  console.log(`\n  LO checks (${loChecks.length}):`);
  table(loChecks as unknown as Array<Record<string, unknown>>, ["checkId", "label", "pass", "confidence", "evidenceSpan"]);

  console.log(`\n  Grammar checks (${grammarChecks.length}):`);
  table(grammarChecks as unknown as Array<Record<string, unknown>>, ["checkId", "label", "pass", "confidence", "opportunityType", "evidenceSpan"]);

  console.log(`\n  Vocab checks (${vocabChecks.length}):`);
  table(vocabChecks as unknown as Array<Record<string, unknown>>, ["nodeId", "label", "pass", "confidence", "opportunityType", "evidenceSpan"]);

  // --- Delta with stored evidence ---
  heading("STORED EVIDENCE vs REPLAY DELTA");
  const stored = attempt.gseEvidence;
  console.log(`  Stored evidence rows: ${stored.length}`);
  const storedNodeIds = new Set(stored.map((e) => e.nodeId));

  const replayNodeIds = new Set([
    ...loChecks.filter((c) => c.pass).map((c) => c.checkId),
    ...grammarChecks.filter((c) => c.pass).map((c) => c.descriptorId || c.checkId),
    ...vocabChecks.filter((c) => c.pass).map((c) => c.nodeId),
  ]);

  const newNodes = [...replayNodeIds].filter((id) => !storedNodeIds.has(id));
  const missingNodes = [...storedNodeIds].filter((id) => !replayNodeIds.has(id));

  console.log(`  Replay pass nodes: ${replayNodeIds.size}`);
  console.log(`  NEW (in replay but not stored): ${newNodes.length}`);
  for (const id of newNodes.slice(0, 20)) console.log(`    + ${id}`);
  console.log(`  MISSING (in stored but not replay): ${missingNodes.length}`);
  for (const id of missingNodes.slice(0, 20)) console.log(`    - ${id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
