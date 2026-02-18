const DEFAULT_POLICY_VERSION = "policy-hybrid-guardrailed-v1";
const DEFAULT_RULE_WEIGHT = 0.45;
const DEFAULT_LEARNED_WEIGHT = 0.55;
const DEFAULT_EXPLORATION_FLOOR = 0.08;
const DEFAULT_TEMPERATURE = 0.7;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function dedupe(items: string[]) {
  return Array.from(new Set(items));
}

function stableSort(actions: string[], byScore: Record<string, number>) {
  return [...actions].sort((left, right) => {
    const leftScore = byScore[left] ?? Number.NEGATIVE_INFINITY;
    const rightScore = byScore[right] ?? Number.NEGATIVE_INFINITY;
    if (leftScore === rightScore) return left.localeCompare(right);
    return rightScore - leftScore;
  });
}

function buildSoftmaxProbabilities(actions: string[], scores: Record<string, number>, temperature: number) {
  if (actions.length === 0) return {} as Record<string, number>;

  const safeTemperature = clamp(temperature, 0.05, 5);
  const logits = actions.map((action) => (scores[action] ?? 0) / safeTemperature);
  const maxLogit = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - maxLogit));
  const denom = exps.reduce((sum, value) => sum + value, 0);

  const probabilities: Record<string, number> = {};
  actions.forEach((action, index) => {
    probabilities[action] = denom > 0 ? exps[index] / denom : 1 / actions.length;
  });
  return probabilities;
}

function applyExplorationFloor(
  actions: string[],
  baseProbabilities: Record<string, number>,
  explorationFloor: number
) {
  if (actions.length === 0) return {} as Record<string, number>;

  const perActionFloor = clamp(explorationFloor, 0, 1 / actions.length);
  const floorMass = perActionFloor * actions.length;
  if (floorMass >= 1) {
    const uniform = 1 / actions.length;
    return Object.fromEntries(actions.map((action) => [action, uniform])) as Record<string, number>;
  }

  const probabilities: Record<string, number> = {};
  for (const action of actions) {
    const base = baseProbabilities[action] ?? 0;
    probabilities[action] = base * (1 - floorMass) + perActionFloor;
  }
  return probabilities;
}

function normalizeWeights(ruleWeight: number, learnedWeight: number) {
  const safeRule = Number.isFinite(ruleWeight) ? Math.max(0, ruleWeight) : DEFAULT_RULE_WEIGHT;
  const safeLearned = Number.isFinite(learnedWeight) ? Math.max(0, learnedWeight) : DEFAULT_LEARNED_WEIGHT;
  const sum = safeRule + safeLearned;
  if (sum <= 0) {
    return {
      ruleWeight: 0.5,
      learnedWeight: 0.5,
    };
  }
  return {
    ruleWeight: safeRule / sum,
    learnedWeight: safeLearned / sum,
  };
}

export type HybridSelectorCandidate = {
  actionId: string;
  ruleUtility: number;
  learnedValue: number;
  hardConstraintReasons?: string[];
};

export type HybridSelectorResult = {
  policyVersion: string;
  chosenAction: string;
  propensity: number;
  candidateActionSet: string[];
  preActionScores: Record<string, number>;
  propensityByAction: Record<string, number>;
  constraintMask: Record<string, string[]>;
  activeConstraints: string[];
  blockedActions: string[];
  explorationFloor: number;
  temperature: number;
  ruleWeight: number;
  learnedWeight: number;
  fallbackApplied: boolean;
};

export function runGuardrailedHybridSelector(params: {
  candidates: HybridSelectorCandidate[];
  policyVersion?: string;
  ruleWeight?: number;
  learnedWeight?: number;
  explorationFloor?: number;
  temperature?: number;
}): HybridSelectorResult {
  if (!Array.isArray(params.candidates) || params.candidates.length === 0) {
    throw new Error("Hybrid selector requires at least one candidate.");
  }

  const policyVersion = params.policyVersion || DEFAULT_POLICY_VERSION;
  const explorationFloor = clamp(
    Number.isFinite(params.explorationFloor) ? (params.explorationFloor as number) : DEFAULT_EXPLORATION_FLOOR,
    0,
    0.49
  );
  const temperature = clamp(
    Number.isFinite(params.temperature) ? (params.temperature as number) : DEFAULT_TEMPERATURE,
    0.05,
    5
  );
  const normalized = normalizeWeights(
    typeof params.ruleWeight === "number" ? params.ruleWeight : DEFAULT_RULE_WEIGHT,
    typeof params.learnedWeight === "number" ? params.learnedWeight : DEFAULT_LEARNED_WEIGHT
  );

  const constraintMask: Record<string, string[]> = {};
  const activeConstraints: string[] = [];
  for (const candidate of params.candidates) {
    const reasons = dedupe((candidate.hardConstraintReasons || []).filter((item) => item.trim().length > 0));
    constraintMask[candidate.actionId] = reasons;
    activeConstraints.push(...reasons);
  }

  const feasibleCandidates = params.candidates.filter(
    (candidate) => (constraintMask[candidate.actionId] || []).length === 0
  );

  const fallbackCandidate = [...params.candidates].sort((left, right) => {
    if (left.ruleUtility === right.ruleUtility) return left.actionId.localeCompare(right.actionId);
    return right.ruleUtility - left.ruleUtility;
  })[0];

  if (!fallbackCandidate) {
    throw new Error("Hybrid selector cannot resolve fallback candidate.");
  }

  if (feasibleCandidates.length === 0) {
    return {
      policyVersion,
      chosenAction: fallbackCandidate.actionId,
      propensity: 1,
      candidateActionSet: [fallbackCandidate.actionId],
      preActionScores: { [fallbackCandidate.actionId]: round(fallbackCandidate.ruleUtility) },
      propensityByAction: { [fallbackCandidate.actionId]: 1 },
      constraintMask,
      activeConstraints: dedupe([...activeConstraints, "hard_constraint_fallback"]),
      blockedActions: params.candidates.map((candidate) => candidate.actionId),
      explorationFloor,
      temperature,
      ruleWeight: round(normalized.ruleWeight),
      learnedWeight: round(normalized.learnedWeight),
      fallbackApplied: true,
    };
  }

  const preActionScores: Record<string, number> = {};
  for (const candidate of feasibleCandidates) {
    preActionScores[candidate.actionId] = round(
      candidate.ruleUtility * normalized.ruleWeight + candidate.learnedValue * normalized.learnedWeight
    );
  }

  const candidateActionSet = stableSort(
    feasibleCandidates.map((candidate) => candidate.actionId),
    preActionScores
  );
  const baseProbabilities = buildSoftmaxProbabilities(candidateActionSet, preActionScores, temperature);
  const propensityByAction = applyExplorationFloor(candidateActionSet, baseProbabilities, explorationFloor);

  let chosenAction = candidateActionSet[0];
  for (const action of candidateActionSet.slice(1)) {
    const currentPropensity = propensityByAction[chosenAction] ?? 0;
    const nextPropensity = propensityByAction[action] ?? 0;
    if (nextPropensity > currentPropensity) {
      chosenAction = action;
      continue;
    }
    if (nextPropensity === currentPropensity) {
      const currentScore = preActionScores[chosenAction] ?? Number.NEGATIVE_INFINITY;
      const nextScore = preActionScores[action] ?? Number.NEGATIVE_INFINITY;
      if (nextScore > currentScore || (nextScore === currentScore && action.localeCompare(chosenAction) < 0)) {
        chosenAction = action;
      }
    }
  }

  const blockedActions = params.candidates
    .filter((candidate) => (constraintMask[candidate.actionId] || []).length > 0)
    .map((candidate) => candidate.actionId);

  return {
    policyVersion,
    chosenAction,
    propensity: round(propensityByAction[chosenAction] ?? 0),
    candidateActionSet,
    preActionScores,
    propensityByAction: Object.fromEntries(
      candidateActionSet.map((action) => [action, round(propensityByAction[action] ?? 0)])
    ) as Record<string, number>,
    constraintMask,
    activeConstraints: dedupe([...activeConstraints, "hard_constraints_enforced", "exploration_floor"]),
    blockedActions,
    explorationFloor,
    temperature,
    ruleWeight: round(normalized.ruleWeight),
    learnedWeight: round(normalized.learnedWeight),
    fallbackApplied: false,
  };
}

export const HYBRID_SELECTOR_DEFAULTS = {
  policyVersion: DEFAULT_POLICY_VERSION,
  ruleWeight: DEFAULT_RULE_WEIGHT,
  learnedWeight: DEFAULT_LEARNED_WEIGHT,
  explorationFloor: DEFAULT_EXPLORATION_FLOOR,
  temperature: DEFAULT_TEMPERATURE,
} as const;
