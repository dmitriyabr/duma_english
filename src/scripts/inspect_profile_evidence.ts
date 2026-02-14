/**
 * Deep profile inspection: why so few streaks, why small deltas, what evidence kinds.
 * Run: npx tsx src/scripts/inspect_profile_evidence.ts [studentId]
 * If no studentId: uses the student with the most recent completed attempt.
 */
import "dotenv/config";
import { prisma } from "../lib/db";

const LAST_N_ATTEMPTS = 50;

async function main() {
  const studentIdArg = process.argv[2];
  let studentId = studentIdArg;
  if (!studentId) {
    const latest = await prisma.attempt.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
      select: { studentId: true },
    });
    if (!latest) {
      console.log("No completed attempts. Pass studentId.");
      process.exit(1);
    }
    studentId = latest.studentId;
    console.log("Using student (most recent attempt):", studentId.slice(0, 12) + "...\n");
  }

  const attempts = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    orderBy: { completedAt: "desc" },
    take: LAST_N_ATTEMPTS,
    include: {
      task: { select: { type: true, prompt: true } },
      gseEvidence: {
        select: {
          nodeId: true,
          signalType: true,
          evidenceKind: true,
          opportunityType: true,
          score: true,
          weight: true,
          domain: true,
        },
      },
    },
  });

  const nodeIds = [...new Set(attempts.flatMap((a) => a.gseEvidence.map((e) => e.nodeId)))];
  const nodes =
    nodeIds.length > 0
      ? await prisma.gseNode.findMany({
          where: { nodeId: { in: nodeIds } },
          select: { nodeId: true, descriptor: true, type: true },
        })
      : [];
  const nodeById = new Map(nodes.map((n) => [n.nodeId, n]));

  type OutcomeRow = {
    nodeId: string;
    deltaMastery: number;
    streakMultiplier?: number;
    previousMean?: number;
    nextMean?: number;
  };

  console.log("=== 1) Evidence by kind (last", attempts.length, "attempts) ===\n");
  const byKind: Record<string, number> = {};
  const byKindOpportunity: Record<string, number> = {};
  for (const a of attempts) {
    for (const e of a.gseEvidence) {
      byKind[e.evidenceKind] = (byKind[e.evidenceKind] || 0) + 1;
      const key = `${e.evidenceKind}:${e.opportunityType}`;
      byKindOpportunity[key] = (byKindOpportunity[key] || 0) + 1;
    }
  }
  console.log("  By kind:", byKind);
  console.log("  By kind:opportunity:", byKindOpportunity);
  console.log(
    "\n  → Streak applies only when kind=direct AND score>=0.7. If most evidence is 'supporting', you will almost never see streak.\n"
  );

  console.log("=== 2) Evidence per descriptor (sample: ask, want, feel, play, too) ===\n");
  const descCount: Record<string, { direct: number; supporting: number; negative: number }> = {};
  for (const a of attempts) {
    for (const e of a.gseEvidence) {
      const node = nodeById.get(e.nodeId);
      const desc = (node?.descriptor ?? e.nodeId).trim().toLowerCase();
      if (!descCount[desc]) descCount[desc] = { direct: 0, supporting: 0, negative: 0 };
      if (e.evidenceKind === "direct") descCount[desc].direct++;
      else if (e.evidenceKind === "supporting") descCount[desc].supporting++;
      else descCount[desc].negative++;
    }
  }
  const sampleWords = ["ask", "want", "feel", "play", "too", "have", "can", "like"];
  for (const word of sampleWords) {
    const match = Object.entries(descCount).find(([d]) => d.includes(word) || word.includes(d));
    if (match) {
      const [desc, c] = match;
      console.log(`  "${desc}": direct=${c.direct} supporting=${c.supporting} negative=${c.negative}`);
    }
  }
  console.log("");

  console.log("=== 3) Last 5 attempts: task type, evidence sample, outcomes with streak ===\n");
  for (const a of attempts.slice(0, 5)) {
    const task = a.task;
    const outcomes = (Array.isArray(a.nodeOutcomesJson) ? a.nodeOutcomesJson : []) as OutcomeRow[];
    const withStreak = outcomes.filter((o) => typeof o.streakMultiplier === "number");
    console.log(`  ${a.completedAt?.toISOString?.()?.slice(0, 19)} | ${task?.type ?? "?"}`);
    const evSample = a.gseEvidence.slice(0, 4);
    for (const e of evSample) {
      const node = nodeById.get(e.nodeId);
      const desc = (node?.descriptor ?? e.nodeId).slice(0, 28);
      console.log(`    ev: ${desc} | ${e.evidenceKind} ${e.opportunityType} score=${e.score?.toFixed(2)} ${e.signalType?.slice(0, 22)}`);
    }
    if (withStreak.length > 0) {
      console.log(`    → streak applied: ${withStreak.map((o) => {
        const node = nodeById.get(o.nodeId);
        return (node?.descriptor ?? o.nodeId).slice(0, 20) + "×" + o.streakMultiplier?.toFixed(2);
      }).join(", ")}`);
    } else if (outcomes.length > 0) {
      console.log(`    → no streak in this attempt (outcomes: ${outcomes.length})`);
    }
    if (a.transcript) {
      console.log(`    transcript: "${String(a.transcript).slice(0, 100)}..."`);
    }
    console.log("");
  }

  console.log("=== 4) Why small deltas (+0.6, +1.0)? ===\n");
  console.log("  - supporting + incidental → baseWeight 0.35 → small alpha/beta move → delta ~0.5–1.0 points.");
  console.log("  - direct + explicit_target → baseWeight 1.0 → larger move; streak then adds 1.15–1.5x.");
  console.log("  - So +0.6 usually means supporting evidence; +1.0 can be one direct or still supporting with higher score.");
  console.log("  - To get streaks and faster growth: need more tasks where the node is TARGET and prompt lists the word (target_vocab or requiredWords).\n");

  console.log("=== 5) Mastery summary for nodes with most evidence ===\n");
  const masteryRows = await prisma.studentGseMastery.findMany({
    where: { studentId },
    orderBy: { evidenceCount: "desc" },
    take: 20,
    include: { node: { select: { descriptor: true, type: true } } },
  });
  for (const m of masteryRows) {
    const val = m.decayedMastery ?? m.masteryMean ?? m.masteryScore;
    const direct = m.directEvidenceCount ?? 0;
    const spacing = (m.spacingStateJson as Record<string, unknown>) || {};
    const streak = typeof spacing.directSuccessStreak === "number" ? spacing.directSuccessStreak : 0;
    console.log(
      `  ${(m.node.descriptor ?? m.nodeId).slice(0, 42)} | value=${val?.toFixed(0)} ev=${m.evidenceCount} direct=${direct} streak=${streak} state=${m.activationState}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
