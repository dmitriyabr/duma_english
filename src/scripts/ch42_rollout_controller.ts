import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/db";
import { getModelPromptRegistry } from "@/lib/registry/modelPromptRegistry";
import { evaluateRolloutDecision, createRolloutLogEntry } from "@/lib/rollout/controller";
import {
  rolloutStateSchema,
  type RolloutState,
  type RolloutControllerLogEntry,
} from "@/lib/contracts/rolloutController";

const DEFAULT_STATE_PATH = "docs/reports/CH42_ROLLOUT_STATE.json";
const DEFAULT_LOG_PATH = "docs/reports/CH42_ROLLOUT_CONTROLLER_LOG.ndjson";

function parseFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseStringFlag(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  return argv[idx + 1] ?? null;
}

function loadState(statePath: string): RolloutState {
  const resolved = resolve(statePath);
  if (!existsSync(resolved)) {
    const registry = getModelPromptRegistry();
    return rolloutStateSchema.parse({
      policyVersion: registry.policyVersion,
      phase: "shadow_only",
      updatedAt: new Date().toISOString(),
      reason: "default_no_state_file",
    });
  }
  const raw = JSON.parse(readFileSync(resolved, "utf8"));
  return rolloutStateSchema.parse(raw);
}

function saveState(statePath: string, state: RolloutState) {
  const resolved = resolve(statePath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(state, null, 2), "utf8");
}

function appendLog(logPath: string, entry: RolloutControllerLogEntry) {
  const resolved = resolve(logPath);
  mkdirSync(dirname(resolved), { recursive: true });
  appendFileSync(resolved, JSON.stringify(entry) + "\n", "utf8");
}

async function main() {
  const argv = process.argv.slice(2);
  const statePath = parseStringFlag(argv, "--state-path") ?? DEFAULT_STATE_PATH;
  const logPath = parseStringFlag(argv, "--log-path") ?? DEFAULT_LOG_PATH;
  const evaluate = parseFlag(argv, "--evaluate");
  const rollbackDrill = parseFlag(argv, "--rollback-drill");
  const apply = parseFlag(argv, "--apply");
  const windowDays = Math.min(14, Math.max(1, parseInt(parseStringFlag(argv, "--window-days") ?? "7", 10) || 7));

  if (rollbackDrill) {
    const state = loadState(statePath);
    const newState: RolloutState = {
      ...state,
      phase: "rolled_back",
      updatedAt: new Date().toISOString(),
      reason: apply ? "rollback_drill_applied" : "rollback_drill_dry_run",
    };
    const entry = createRolloutLogEntry({
      decision: "rollback",
      reason: apply ? "rollback_drill_applied" : "rollback_drill_dry_run",
      currentState: state,
      now: new Date(),
    });
    appendLog(logPath, entry);
    if (apply) {
      saveState(statePath, newState);
      console.log(JSON.stringify({ ok: true, applied: true, newPhase: "rolled_back" }, null, 2));
    } else {
      console.log(JSON.stringify({ ok: true, dryRun: true, wouldSetPhase: "rolled_back" }, null, 2));
    }
    return;
  }

  if (evaluate) {
    const state = loadState(statePath);
    const result = await evaluateRolloutDecision({
      currentState: state,
      windowDays,
    });
    const entry = createRolloutLogEntry({
      decision: result.decision,
      reason: result.reason,
      currentState: state,
      metricsSnapshot: result.metricsSnapshot,
    });
    appendLog(logPath, entry);

    if (apply && result.decision === "rollback" && result.suggestedPhase === "rolled_back") {
      const newState: RolloutState = {
        ...state,
        phase: "rolled_back",
        updatedAt: new Date().toISOString(),
        reason: result.reason,
      };
      saveState(statePath, newState);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          decision: result.decision,
          reason: result.reason,
          metricsSnapshot: result.metricsSnapshot,
          stateApplied: apply && result.decision === "rollback",
          logPath: resolve(logPath),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify({
      usage: "ch42_rollout_controller.ts --evaluate [--apply] [--window-days 7] [--state-path PATH] [--log-path PATH]",
      rollbackDrill: "--rollback-drill [--apply]",
    }),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
