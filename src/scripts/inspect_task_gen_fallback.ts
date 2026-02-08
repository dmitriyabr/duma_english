/**
 * Inspect recent task generation: which tasks used fallback and why.
 * Run: npx tsx src/scripts/inspect_task_gen_fallback.ts [limit]
 * Default limit 20.
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const limit = Math.min(50, Math.max(5, parseInt(process.argv[2] || "20", 10) || 20));
  const rows = await prisma.taskInstance.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      taskType: true,
      fallbackUsed: true,
      createdAt: true,
      specJson: true,
    },
  });

  console.log(`=== Last ${rows.length} task instances (fallback = used template instead of LLM) ===\n`);
  let fallbackCount = 0;
  const reasons: Record<string, number> = {};
  for (const r of rows) {
    const spec = (r.specJson || {}) as { fallbackReason?: string | null };
    const reason = spec.fallbackReason ?? (r.fallbackUsed ? "unknown" : null);
    if (r.fallbackUsed) {
      fallbackCount++;
      if (reason && reason !== "unknown") reasons[reason] = (reasons[reason] || 0) + 1;
    }
    console.log(
      `${r.createdAt.toISOString()} | ${r.taskType.padEnd(14)} | fallback=${r.fallbackUsed}${reason ? ` | reason=${reason}` : ""}`
    );
  }
  console.log(`\nFallback used: ${fallbackCount}/${rows.length}`);
  if (Object.keys(reasons).length > 0) {
    console.log("Reasons:", reasons);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
