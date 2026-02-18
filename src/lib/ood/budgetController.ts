export const OOD_BUDGET_CONTROLLER_VERSION = "ood-budget-controller-v1" as const;
export const OOD_BUDGET_MIN_RATE = 0.1;
export const OOD_BUDGET_MAX_RATE = 0.2;
export const OOD_BUDGET_BASE_RATE = 0.14;

export type OodBudgetSignal = {
  verdict: string | null;
  status: string;
  createdAt: Date;
};

export type OodBudgetDecision = {
  controllerVersion: typeof OOD_BUDGET_CONTROLLER_VERSION;
  taskOrdinal: number;
  budgetRate: number;
  interval: number;
  shouldInject: boolean;
  milestonePressure: boolean;
  overfitRisk: boolean;
  reasons: string[];
  recentStats: {
    evaluatedOodCount: number;
    passCount: number;
    failCount: number;
    inconclusiveCount: number;
    passRate: number | null;
    failStreak: number;
  };
};

function round(value: number) {
  return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeVerdict(verdict: string | null) {
  if (!verdict) return "unknown" as const;
  const normalized = verdict.trim().toLowerCase();
  if (!normalized) return "unknown" as const;
  if (normalized.includes("pass") || normalized.includes("success")) return "pass" as const;
  if (normalized.includes("fail")) return "fail" as const;
  if (normalized.includes("inconclusive")) return "inconclusive" as const;
  return "unknown" as const;
}

function parseMilestonePressure(selectionReasonType: string, primaryGoal: string | null | undefined) {
  if (selectionReasonType === "verification") return true;
  const goal = (primaryGoal || "").toLowerCase();
  return goal.includes("milestone") || goal.includes("promotion") || goal.includes("verify");
}

export function computeOodBudgetDecision(params: {
  taskOrdinal: number;
  selectionReasonType: string;
  primaryGoal?: string | null;
  recentSignals?: OodBudgetSignal[];
}): OodBudgetDecision {
  const recentSignals = params.recentSignals || [];
  let passCount = 0;
  let failCount = 0;
  let inconclusiveCount = 0;
  let failStreak = 0;

  for (const signal of recentSignals) {
    const normalized = normalizeVerdict(signal.verdict);
    if (normalized === "pass") passCount += 1;
    else if (normalized === "fail") failCount += 1;
    else if (normalized === "inconclusive") inconclusiveCount += 1;
  }

  for (const signal of recentSignals) {
    if (normalizeVerdict(signal.verdict) === "fail") failStreak += 1;
    else break;
  }

  const evaluatedOodCount = passCount + failCount;
  const passRate = evaluatedOodCount > 0 ? passCount / evaluatedOodCount : null;

  const milestonePressure = parseMilestonePressure(params.selectionReasonType, params.primaryGoal);
  const overfitRisk =
    (evaluatedOodCount >= 3 && typeof passRate === "number" && passRate < 0.5) || failStreak >= 2;

  const reasons: string[] = [];
  let budgetRate = OOD_BUDGET_BASE_RATE;
  reasons.push("base");

  if (milestonePressure) {
    budgetRate += 0.03;
    reasons.push("milestone_pressure");
  }
  if (overfitRisk) {
    budgetRate += 0.03;
    reasons.push("overfit_risk");
  }

  budgetRate = clamp(budgetRate, OOD_BUDGET_MIN_RATE, OOD_BUDGET_MAX_RATE);
  const interval = Math.max(5, Math.min(10, Math.round(1 / budgetRate)));
  const shouldInject = params.taskOrdinal > 0 && params.taskOrdinal % interval === 0;

  return {
    controllerVersion: OOD_BUDGET_CONTROLLER_VERSION,
    taskOrdinal: params.taskOrdinal,
    budgetRate: round(budgetRate),
    interval,
    shouldInject,
    milestonePressure,
    overfitRisk,
    reasons,
    recentStats: {
      evaluatedOodCount,
      passCount,
      failCount,
      inconclusiveCount,
      passRate: typeof passRate === "number" ? round(passRate) : null,
      failStreak,
    },
  };
}
