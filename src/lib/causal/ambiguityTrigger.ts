import { normalizeCausalLabel, type CausalCoreLabel } from "@/lib/db/types";

export const CAUSAL_AMBIGUITY_THRESHOLDS = {
  entropyMax: 0.62,
  marginMin: 0.16,
  deltaActionValue: 0.24,
} as const;

export type PlannerActionFamily = "diagnostic_probe" | "targeted_practice" | "transfer_probe";

export type PlannerActionCandidate = {
  taskType: string;
  utility: number;
};

export type CausalSnapshot = {
  topLabel?: string | null;
  entropy?: number | null;
  topMargin?: number | null;
  distributionJson?: unknown;
  modelVersion?: string | null;
  attemptId?: string | null;
};

export type AmbiguityTriggerEvaluation = {
  evaluated: boolean;
  posteriorAmbiguous: boolean;
  materialInstability: boolean;
  shouldTrigger: boolean;
  triggered: boolean;
  wouldChangeDecision: boolean;
  chosenTaskType: string;
  chosenActionFamily: PlannerActionFamily;
  recommendedProbeTaskType: string | null;
  recommendedProbeUtility: number | null;
  topCauseLabels: [CausalCoreLabel, CausalCoreLabel];
  topCauseActionFamilies: [PlannerActionFamily, PlannerActionFamily];
  actionValueGap: number | null;
  thresholds: {
    entropyMax: number;
    marginMin: number;
    deltaActionValue: number;
  };
  metrics: {
    entropy: number | null;
    topMargin: number | null;
  };
  reasonCodes: string[];
};

export function mapTaskTypeToActionFamily(taskType: string): PlannerActionFamily {
  if (
    taskType === "target_vocab" ||
    taskType === "speech_builder" ||
    taskType === "reading_comprehension" ||
    taskType === "writing_prompt"
  ) {
    return "targeted_practice";
  }
  if (
    taskType === "role_play" ||
    taskType === "topic_talk" ||
    taskType === "argumentation" ||
    taskType === "register_switch" ||
    taskType === "misunderstanding_repair"
  ) {
    return "transfer_probe";
  }
  return "diagnostic_probe";
}

const causeToActionFamily: Record<CausalCoreLabel, PlannerActionFamily> = {
  rule_confusion: "targeted_practice",
  l1_interference: "transfer_probe",
  retrieval_failure: "targeted_practice",
  instruction_misread: "diagnostic_probe",
  attention_loss: "diagnostic_probe",
  production_constraint: "diagnostic_probe",
  mixed: "diagnostic_probe",
  unknown: "diagnostic_probe",
};

function toFiniteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTopCauseLabels(snapshot: CausalSnapshot): [CausalCoreLabel, CausalCoreLabel] {
  const labels: CausalCoreLabel[] = [];
  if (Array.isArray(snapshot.distributionJson)) {
    const entries = snapshot.distributionJson
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const probability = toFiniteOrNull(row.p);
        if (probability === null || probability < 0) return null;
        return {
          label: normalizeCausalLabel(typeof row.label === "string" ? row.label : "unknown"),
          p: probability,
        };
      })
      .filter((row): row is { label: CausalCoreLabel; p: number } => row !== null)
      .sort((left, right) => right.p - left.p);

    for (const row of entries) {
      if (!labels.includes(row.label)) labels.push(row.label);
      if (labels.length >= 2) break;
    }
  }

  const fallbackTop = normalizeCausalLabel(snapshot.topLabel || "unknown");
  if (!labels.includes(fallbackTop)) labels.unshift(fallbackTop);
  while (labels.length < 2) labels.push("unknown");
  return [labels[0], labels[1]];
}

function pickBestByActionFamily(candidates: PlannerActionCandidate[]) {
  const best = new Map<PlannerActionFamily, PlannerActionCandidate>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.utility)) continue;
    const family = mapTaskTypeToActionFamily(candidate.taskType);
    const current = best.get(family);
    if (!current || candidate.utility > current.utility) {
      best.set(family, candidate);
    }
  }
  return best;
}

function round(value: number) {
  return Number(value.toFixed(4));
}

export function evaluateAmbiguityTrigger(params: {
  chosenTaskType: string;
  candidates: PlannerActionCandidate[];
  causalSnapshot?: CausalSnapshot | null;
  thresholds?: Partial<typeof CAUSAL_AMBIGUITY_THRESHOLDS>;
}): AmbiguityTriggerEvaluation {
  const thresholds = {
    entropyMax: params.thresholds?.entropyMax ?? CAUSAL_AMBIGUITY_THRESHOLDS.entropyMax,
    marginMin: params.thresholds?.marginMin ?? CAUSAL_AMBIGUITY_THRESHOLDS.marginMin,
    deltaActionValue: params.thresholds?.deltaActionValue ?? CAUSAL_AMBIGUITY_THRESHOLDS.deltaActionValue,
  };

  const emptyResult: AmbiguityTriggerEvaluation = {
    evaluated: false,
    posteriorAmbiguous: false,
    materialInstability: false,
    shouldTrigger: false,
    triggered: false,
    wouldChangeDecision: false,
    chosenTaskType: params.chosenTaskType,
    chosenActionFamily: mapTaskTypeToActionFamily(params.chosenTaskType),
    recommendedProbeTaskType: null,
    recommendedProbeUtility: null,
    topCauseLabels: ["unknown", "unknown"],
    topCauseActionFamilies: ["diagnostic_probe", "diagnostic_probe"],
    actionValueGap: null,
    thresholds,
    metrics: {
      entropy: null,
      topMargin: null,
    },
    reasonCodes: ["no_causal_snapshot"],
  };

  const snapshot = params.causalSnapshot;
  if (!snapshot) return emptyResult;

  const entropy = toFiniteOrNull(snapshot.entropy);
  const topMargin = toFiniteOrNull(snapshot.topMargin);
  const reasonCodes: string[] = [];

  const entropyHigh = typeof entropy === "number" && entropy > thresholds.entropyMax;
  const marginLow = typeof topMargin === "number" && topMargin < thresholds.marginMin;
  const posteriorAmbiguous = entropyHigh || marginLow;
  if (entropyHigh) reasonCodes.push("entropy_high");
  if (marginLow) reasonCodes.push("margin_low");

  const [topCause, secondCause] = parseTopCauseLabels(snapshot);
  const topAction = causeToActionFamily[topCause];
  const secondAction = causeToActionFamily[secondCause];
  const bestByAction = pickBestByActionFamily(params.candidates);
  const topActionBest = bestByAction.get(topAction);
  const secondActionBest = bestByAction.get(secondAction);

  let actionValueGap: number | null = null;
  let materialInstability = false;
  if (topAction !== secondAction) {
    if (topActionBest && secondActionBest) {
      actionValueGap = round(Math.abs(topActionBest.utility - secondActionBest.utility));
      materialInstability = actionValueGap >= thresholds.deltaActionValue;
      if (!materialInstability) reasonCodes.push("action_value_gap_small");
    } else {
      reasonCodes.push("insufficient_action_candidates");
    }
  } else {
    reasonCodes.push("top_causes_same_action_family");
  }

  const shouldTrigger = posteriorAmbiguous && materialInstability;
  const recommendedProbe = bestByAction.get("diagnostic_probe") || null;
  if (!recommendedProbe) {
    reasonCodes.push("no_diagnostic_probe_candidate");
  }
  const wouldChangeDecision =
    Boolean(recommendedProbe) && recommendedProbe!.taskType !== params.chosenTaskType;
  if (shouldTrigger && !wouldChangeDecision && recommendedProbe) {
    reasonCodes.push("diagnostic_probe_already_selected");
  }

  const triggered = shouldTrigger && wouldChangeDecision && Boolean(recommendedProbe);
  if (triggered) reasonCodes.push("triggered");

  return {
    evaluated: true,
    posteriorAmbiguous,
    materialInstability,
    shouldTrigger,
    triggered,
    wouldChangeDecision,
    chosenTaskType: params.chosenTaskType,
    chosenActionFamily: mapTaskTypeToActionFamily(params.chosenTaskType),
    recommendedProbeTaskType: recommendedProbe?.taskType ?? null,
    recommendedProbeUtility:
      typeof recommendedProbe?.utility === "number" ? round(recommendedProbe.utility) : null,
    topCauseLabels: [topCause, secondCause],
    topCauseActionFamilies: [topAction, secondAction],
    actionValueGap,
    thresholds,
    metrics: {
      entropy,
      topMargin,
    },
    reasonCodes,
  };
}
