import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";

type CliOptions = {
  studentId?: string;
  decisionLogId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  format: "ndjson" | "json";
  outputPath?: string;
  includePayload: boolean;
};

type ReplayRow = {
  eventId: string;
  eventType: string;
  eventTs: string;
  studentId: string | null;
  linkage: {
    decisionId: string | null;
    taskInstanceId: string | null;
    taskId: string | null;
    attemptId: string | null;
    evidenceId: string | null;
    delayedOutcomeId: string | null;
  };
  payload?: unknown;
};

function usage() {
  return [
    "Usage:",
    "  npx tsx src/scripts/export_replay_event_log.ts [options]",
    "",
    "Options:",
    "  --student <id>        filter by studentId",
    "  --decision <id>       filter by decisionLogId",
    "  --from <iso>          createdAt >= from",
    "  --to <iso>            createdAt <= to",
    "  --limit <n>           max events (default 5000, max 50000)",
    "  --format <ndjson|json> output format (default ndjson)",
    "  --out <path>          output file path (default stdout)",
    "  --no-payload          omit payloadJson from exported rows",
  ].join("\n");
}

function parseDateFlag(value: string | undefined, flagName: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${flagName} value: ${value}`);
  }
  return parsed;
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 5000,
    format: "ndjson",
    includePayload: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--student") {
      options.studentId = argv[++i];
    } else if (arg === "--decision") {
      options.decisionLogId = argv[++i];
    } else if (arg === "--from") {
      options.from = parseDateFlag(argv[++i], "--from");
    } else if (arg === "--to") {
      options.to = parseDateFlag(argv[++i], "--to");
    } else if (arg === "--limit") {
      const parsed = Number(argv[++i]);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --limit value: ${argv[i]}`);
      options.limit = Math.min(50000, Math.max(1, Math.floor(parsed)));
    } else if (arg === "--format") {
      const format = argv[++i];
      if (format !== "ndjson" && format !== "json") throw new Error(`Invalid --format value: ${format}`);
      options.format = format;
    } else if (arg === "--out") {
      options.outputPath = argv[++i];
    } else if (arg === "--no-payload") {
      options.includePayload = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function buildWhere(options: CliOptions): Prisma.AutopilotEventLogWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (options.from) createdAt.gte = options.from;
  if (options.to) createdAt.lte = options.to;
  return {
    studentId: options.studentId,
    decisionLogId: options.decisionLogId,
    ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
  };
}

function summarize(rows: ReplayRow[]) {
  const countsByType: Record<string, number> = {};
  let fullTraceCount = 0;
  const decisions = new Set<string>();
  const tasks = new Set<string>();
  const attempts = new Set<string>();
  const evidences = new Set<string>();
  const delayedOutcomes = new Set<string>();

  for (const row of rows) {
    countsByType[row.eventType] = (countsByType[row.eventType] || 0) + 1;
    if (row.linkage.decisionId) decisions.add(row.linkage.decisionId);
    if (row.linkage.taskId) tasks.add(row.linkage.taskId);
    if (row.linkage.attemptId) attempts.add(row.linkage.attemptId);
    if (row.linkage.evidenceId) evidences.add(row.linkage.evidenceId);
    if (row.linkage.delayedOutcomeId) delayedOutcomes.add(row.linkage.delayedOutcomeId);
    if (
      row.linkage.decisionId &&
      row.linkage.taskId &&
      row.linkage.attemptId &&
      row.linkage.evidenceId &&
      row.linkage.delayedOutcomeId
    ) {
      fullTraceCount += 1;
    }
  }

  return {
    totalEvents: rows.length,
    countsByType,
    fullTraceRows: fullTraceCount,
    uniqueDecisions: decisions.size,
    uniqueTasks: tasks.size,
    uniqueAttempts: attempts.size,
    uniqueEvidenceRows: evidences.size,
    uniqueDelayedOutcomes: delayedOutcomes.size,
  };
}

function toOutput(rows: ReplayRow[], format: "ndjson" | "json") {
  if (format === "json") {
    return JSON.stringify(rows, null, 2);
  }
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const dbRows = await prisma.autopilotEventLog.findMany({
    where: buildWhere(options),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: options.limit,
    select: {
      id: true,
      eventType: true,
      createdAt: true,
      studentId: true,
      decisionLogId: true,
      taskInstanceId: true,
      taskId: true,
      attemptId: true,
      evidenceId: true,
      delayedOutcomeId: true,
      payloadJson: true,
    },
  });

  const rows: ReplayRow[] = dbRows.map((row) => ({
    eventId: row.id,
    eventType: row.eventType,
    eventTs: row.createdAt.toISOString(),
    studentId: row.studentId,
    linkage: {
      decisionId: row.decisionLogId,
      taskInstanceId: row.taskInstanceId,
      taskId: row.taskId,
      attemptId: row.attemptId,
      evidenceId: row.evidenceId,
      delayedOutcomeId: row.delayedOutcomeId,
    },
    ...(options.includePayload ? { payload: row.payloadJson } : {}),
  }));

  const summary = summarize(rows);
  const output = toOutput(rows, options.format);

  if (options.outputPath) {
    const resolvedPath = resolve(options.outputPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, output, "utf8");
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputPath: resolvedPath,
          format: options.format,
          includePayload: options.includePayload,
          summary,
        },
        null,
        2
      )
    );
  } else {
    if (output.length > 0) {
      process.stdout.write(output);
      if (options.format === "ndjson") process.stdout.write("\n");
    }
    console.error(JSON.stringify({ ok: true, summary }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
