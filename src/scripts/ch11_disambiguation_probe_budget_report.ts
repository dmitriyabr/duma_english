import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/db";

type Options = {
  days: number;
  limit: number;
  outputPath: string | null;
};

type ProbeMeta = {
  enabled: boolean;
  reasonCode: string;
  probeSkill: string | null;
  topCauseLabels: string[];
  budget: {
    sessionWindowMinutes: number;
    maxPerSession: number;
    maxPerSkillPerSession: number;
    maxPerCausePairPerSession: number;
  } | null;
};

type ProbeRow = {
  studentId: string;
  taskType: string;
  createdAt: Date;
  meta: ProbeMeta;
};

function parseIntFlag(args: string[], flag: string, fallback: number) {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return fallback;
  const raw = Number(args[index + 1]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

function parseStringFlag(args: string[], flag: string) {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function parseOptions(args: string[]): Options {
  return {
    days: parseIntFlag(args, "--days", 30),
    limit: parseIntFlag(args, "--limit", 3000),
    outputPath: parseStringFlag(args, "--output"),
  };
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function pairKey(labels: string[]) {
  const normalized = labels.filter(Boolean).slice(0, 2).sort();
  return normalized.join("+") || "unknown+unknown";
}

function parseProbeMeta(metaJson: unknown): ProbeMeta | null {
  if (!metaJson || typeof metaJson !== "object") return null;
  const row = metaJson as Record<string, unknown>;
  const probe = row.causalDisambiguationProbe;
  if (!probe || typeof probe !== "object") return null;
  const probeRow = probe as Record<string, unknown>;
  const budgetRaw = probeRow.budget;
  const budget =
    budgetRaw && typeof budgetRaw === "object"
      ? {
          sessionWindowMinutes:
            typeof (budgetRaw as Record<string, unknown>).sessionWindowMinutes === "number"
              ? Math.max(1, Number((budgetRaw as Record<string, unknown>).sessionWindowMinutes))
              : 90,
          maxPerSession:
            typeof (budgetRaw as Record<string, unknown>).maxPerSession === "number"
              ? Math.max(1, Number((budgetRaw as Record<string, unknown>).maxPerSession))
              : 2,
          maxPerSkillPerSession:
            typeof (budgetRaw as Record<string, unknown>).maxPerSkillPerSession === "number"
              ? Math.max(1, Number((budgetRaw as Record<string, unknown>).maxPerSkillPerSession))
              : 1,
          maxPerCausePairPerSession:
            typeof (budgetRaw as Record<string, unknown>).maxPerCausePairPerSession === "number"
              ? Math.max(1, Number((budgetRaw as Record<string, unknown>).maxPerCausePairPerSession))
              : 1,
        }
      : null;

  return {
    enabled: Boolean(probeRow.enabled),
    reasonCode: typeof probeRow.reasonCode === "string" ? probeRow.reasonCode : "unknown",
    probeSkill: typeof probeRow.probeSkill === "string" ? probeRow.probeSkill : null,
    topCauseLabels: Array.isArray(probeRow.topCauseLabels)
      ? probeRow.topCauseLabels.map((value) => String(value))
      : [],
    budget,
  };
}

async function maybeWriteOutput(path: string | null, report: unknown) {
  if (!path) return;
  const resolved = resolve(process.cwd(), path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const fromTs = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);

  const rows = await prisma.taskInstance.findMany({
    where: {
      createdAt: { gte: fromTs },
    },
    orderBy: { createdAt: "desc" },
    take: options.limit,
    select: {
      studentId: true,
      taskType: true,
      createdAt: true,
      task: {
        select: {
          metaJson: true,
        },
      },
    },
  });

  const allWithProbeField: ProbeRow[] = [];
  for (const row of rows) {
    const meta = parseProbeMeta(row.task.metaJson);
    if (!meta) continue;
    allWithProbeField.push({
      studentId: row.studentId,
      taskType: row.taskType,
      createdAt: row.createdAt,
      meta,
    });
  }

  const probeRows = allWithProbeField.filter((row) => row.meta.enabled);
  const reasonCounts = allWithProbeField.reduce<Record<string, number>>((acc, row) => {
    acc[row.meta.reasonCode] = (acc[row.meta.reasonCode] || 0) + 1;
    return acc;
  }, {});

  const byStudent = new Map<string, ProbeRow[]>();
  for (const row of probeRows) {
    const list = byStudent.get(row.studentId) ?? [];
    list.push(row);
    byStudent.set(row.studentId, list);
  }

  let sessionBudgetViolations = 0;
  let skillBudgetViolations = 0;
  let causePairBudgetViolations = 0;

  for (const studentRows of byStudent.values()) {
    const ordered = [...studentRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i];
      const budget = current.meta.budget || {
        sessionWindowMinutes: 90,
        maxPerSession: 2,
        maxPerSkillPerSession: 1,
        maxPerCausePairPerSession: 1,
      };
      const windowStart = new Date(current.createdAt.getTime() - budget.sessionWindowMinutes * 60 * 1000);
      const inWindow = ordered.filter(
        (row, idx) =>
          idx <= i &&
          row.createdAt >= windowStart &&
          row.createdAt <= current.createdAt
      );

      if (inWindow.length > budget.maxPerSession) {
        sessionBudgetViolations += 1;
      }

      if (current.meta.probeSkill) {
        const sameSkill = inWindow.filter((row) => row.meta.probeSkill === current.meta.probeSkill).length;
        if (sameSkill > budget.maxPerSkillPerSession) {
          skillBudgetViolations += 1;
        }
      }

      const currentPair = pairKey(current.meta.topCauseLabels);
      const samePair = inWindow.filter((row) => pairKey(row.meta.topCauseLabels) === currentPair).length;
      if (samePair > budget.maxPerCausePairPerSession) {
        causePairBudgetViolations += 1;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    window: {
      days: options.days,
      from: fromTs.toISOString(),
    },
    sampleSize: {
      taskInstances: rows.length,
      tasksWithProbeField: allWithProbeField.length,
      enabledProbeTasks: probeRows.length,
    },
    reasonCounts,
    metrics: {
      enabledProbeRate: rows.length > 0 ? round(probeRows.length / rows.length) : 0,
      sessionBudgetViolationRate:
        probeRows.length > 0 ? round(sessionBudgetViolations / probeRows.length) : 0,
      skillBudgetViolationRate:
        probeRows.length > 0 ? round(skillBudgetViolations / probeRows.length) : 0,
      causePairBudgetViolationRate:
        probeRows.length > 0 ? round(causePairBudgetViolations / probeRows.length) : 0,
    },
    violations: {
      sessionBudgetViolations,
      skillBudgetViolations,
      causePairBudgetViolations,
    },
  };

  await maybeWriteOutput(options.outputPath, report);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ch11:disambiguation-probe-budget] ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
