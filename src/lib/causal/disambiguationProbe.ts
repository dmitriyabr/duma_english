import { normalizeCausalLabel, type CausalCoreLabel } from "@/lib/db/types";

type ProbeSkillKey =
  | "vocab_retrieval"
  | "grammar_rule"
  | "instruction_comprehension"
  | "fluency_control"
  | "l1_transfer"
  | "general_diagnostic";

type ProbeTemplateKey =
  | "retrieval_cue_probe"
  | "rule_vs_instruction_probe"
  | "l1_transfer_probe"
  | "fluency_constraint_probe"
  | "generic_ambiguity_probe";

export type DisambiguationProbeRecentTask = {
  taskType: string;
  createdAt: Date;
  metaJson: unknown;
};

type ProbeMetadata = {
  enabled: boolean;
  probeSkill: ProbeSkillKey | null;
  topCauseLabels: CausalCoreLabel[];
};

export type DisambiguationProbePlan = {
  enabled: boolean;
  reasonCode:
    | "not_triggered"
    | "session_budget_exhausted"
    | "skill_budget_exhausted"
    | "cause_pair_budget_exhausted"
    | "ready";
  selectedTaskType: string | null;
  probeSkill: ProbeSkillKey | null;
  templateKey: ProbeTemplateKey | null;
  topCauseLabels: [CausalCoreLabel, CausalCoreLabel];
  budget: {
    sessionWindowMinutes: number;
    maxPerSession: number;
    maxPerSkillPerSession: number;
    maxPerCausePairPerSession: number;
    sessionUsed: number;
    skillUsed: number;
    causePairUsed: number;
  };
};

const DEFAULT_BUDGET = {
  sessionWindowMinutes: 90,
  maxPerSession: 2,
  maxPerSkillPerSession: 1,
  maxPerCausePairPerSession: 1,
} as const;

function normalizeCausePair(labels: [CausalCoreLabel, CausalCoreLabel]) {
  return [...labels].sort().join("+");
}

function parseProbeMetadata(metaJson: unknown): ProbeMetadata | null {
  if (!metaJson || typeof metaJson !== "object") return null;
  const row = metaJson as Record<string, unknown>;
  const probe = row.causalDisambiguationProbe;
  if (!probe || typeof probe !== "object") return null;
  const probeRow = probe as Record<string, unknown>;
  const enabled = Boolean(probeRow.enabled);
  const probeSkill =
    typeof probeRow.probeSkill === "string"
      ? (probeRow.probeSkill as ProbeSkillKey)
      : null;
  const topCauseLabels = Array.isArray(probeRow.topCauseLabels)
    ? probeRow.topCauseLabels
        .map((value) => normalizeCausalLabel(typeof value === "string" ? value : "unknown"))
    : [];
  return {
    enabled,
    probeSkill,
    topCauseLabels,
  };
}

function toCauseLabels(raw: string[] | undefined): [CausalCoreLabel, CausalCoreLabel] {
  const first = normalizeCausalLabel(raw?.[0] || "unknown");
  const second = normalizeCausalLabel(raw?.[1] || "unknown");
  return [first, second];
}

function chooseProbeTemplate(labels: [CausalCoreLabel, CausalCoreLabel]) {
  const [top, second] = labels;
  const set = new Set([top, second]);

  if (set.has("retrieval_failure")) {
    return {
      taskType: "target_vocab",
      probeSkill: "vocab_retrieval" as const,
      templateKey: "retrieval_cue_probe" as const,
    };
  }

  if (set.has("rule_confusion") && set.has("instruction_misread")) {
    return {
      taskType: "qa_prompt",
      probeSkill: "instruction_comprehension" as const,
      templateKey: "rule_vs_instruction_probe" as const,
    };
  }

  if (set.has("l1_interference")) {
    return {
      taskType: "role_play",
      probeSkill: "l1_transfer" as const,
      templateKey: "l1_transfer_probe" as const,
    };
  }

  if (set.has("attention_loss") || set.has("production_constraint")) {
    return {
      taskType: "read_aloud",
      probeSkill: "fluency_control" as const,
      templateKey: "fluency_constraint_probe" as const,
    };
  }

  if (top === "rule_confusion") {
    return {
      taskType: "qa_prompt",
      probeSkill: "grammar_rule" as const,
      templateKey: "rule_vs_instruction_probe" as const,
    };
  }

  return {
    taskType: "qa_prompt",
    probeSkill: "general_diagnostic" as const,
    templateKey: "generic_ambiguity_probe" as const,
  };
}

export function buildDisambiguationPromptGuidance(plan: DisambiguationProbePlan) {
  if (!plan.enabled || !plan.templateKey) return [];
  const pair = `${plan.topCauseLabels[0]} vs ${plan.topCauseLabels[1]}`;
  const base = [
    "Disambiguation probe mode is ON.",
    `Competing causes to separate: ${pair}.`,
    "Keep task as a short micro-probe with one clear diagnostic contrast.",
  ];

  if (plan.templateKey === "retrieval_cue_probe") {
    return [
      ...base,
      "Use 2-3 explicit lexical cues and require learner to reuse each cue in a sentence.",
      "Aim: separate retrieval failure from other causes by checking cued recall lift.",
    ];
  }

  if (plan.templateKey === "rule_vs_instruction_probe") {
    return [
      ...base,
      "Use one instruction-check step followed by one grammar-focused response step.",
      "Aim: separate instruction misread from rule confusion.",
    ];
  }

  if (plan.templateKey === "l1_transfer_probe") {
    return [
      ...base,
      "Use contrastive context (formal vs informal or two interlocutors) in one short role-play.",
      "Aim: separate L1 transfer interference from generic production errors.",
    ];
  }

  if (plan.templateKey === "fluency_constraint_probe") {
    return [
      ...base,
      "Use a brief constrained-response task (1-2 sentences per turn) with explicit pacing cues.",
      "Aim: separate production/attention constraints from language knowledge gaps.",
    ];
  }

  return [
    ...base,
    "Use a concise diagnostic prompt that can cleanly separate the top two causes.",
  ];
}

export function buildDisambiguationProbePlan(params: {
  shouldTrigger: boolean;
  topCauseLabels?: string[];
  recentTasks: DisambiguationProbeRecentTask[];
  now?: Date;
  budget?: Partial<typeof DEFAULT_BUDGET>;
}): DisambiguationProbePlan {
  const budget = {
    sessionWindowMinutes: params.budget?.sessionWindowMinutes ?? DEFAULT_BUDGET.sessionWindowMinutes,
    maxPerSession: params.budget?.maxPerSession ?? DEFAULT_BUDGET.maxPerSession,
    maxPerSkillPerSession: params.budget?.maxPerSkillPerSession ?? DEFAULT_BUDGET.maxPerSkillPerSession,
    maxPerCausePairPerSession:
      params.budget?.maxPerCausePairPerSession ?? DEFAULT_BUDGET.maxPerCausePairPerSession,
  };

  const labels = toCauseLabels(params.topCauseLabels);
  const choice = chooseProbeTemplate(labels);
  const now = params.now || new Date();
  const windowStart = new Date(now.getTime() - budget.sessionWindowMinutes * 60 * 1000);
  const pairKey = normalizeCausePair(labels);

  let sessionUsed = 0;
  let skillUsed = 0;
  let causePairUsed = 0;

  for (const row of params.recentTasks) {
    if (row.createdAt < windowStart) continue;
    const metadata = parseProbeMetadata(row.metaJson);
    if (!metadata?.enabled) continue;
    sessionUsed += 1;
    if (metadata.probeSkill && metadata.probeSkill === choice.probeSkill) {
      skillUsed += 1;
    }
    if (metadata.topCauseLabels.length >= 2) {
      const previousPair = normalizeCausePair([
        metadata.topCauseLabels[0] || "unknown",
        metadata.topCauseLabels[1] || "unknown",
      ]);
      if (previousPair === pairKey) {
        causePairUsed += 1;
      }
    }
  }

  if (!params.shouldTrigger) {
    return {
      enabled: false,
      reasonCode: "not_triggered",
      selectedTaskType: null,
      probeSkill: choice.probeSkill,
      templateKey: choice.templateKey,
      topCauseLabels: labels,
      budget: {
        ...budget,
        sessionUsed,
        skillUsed,
        causePairUsed,
      },
    };
  }

  if (sessionUsed >= budget.maxPerSession) {
    return {
      enabled: false,
      reasonCode: "session_budget_exhausted",
      selectedTaskType: null,
      probeSkill: choice.probeSkill,
      templateKey: choice.templateKey,
      topCauseLabels: labels,
      budget: {
        ...budget,
        sessionUsed,
        skillUsed,
        causePairUsed,
      },
    };
  }

  if (skillUsed >= budget.maxPerSkillPerSession) {
    return {
      enabled: false,
      reasonCode: "skill_budget_exhausted",
      selectedTaskType: null,
      probeSkill: choice.probeSkill,
      templateKey: choice.templateKey,
      topCauseLabels: labels,
      budget: {
        ...budget,
        sessionUsed,
        skillUsed,
        causePairUsed,
      },
    };
  }

  if (causePairUsed >= budget.maxPerCausePairPerSession) {
    return {
      enabled: false,
      reasonCode: "cause_pair_budget_exhausted",
      selectedTaskType: null,
      probeSkill: choice.probeSkill,
      templateKey: choice.templateKey,
      topCauseLabels: labels,
      budget: {
        ...budget,
        sessionUsed,
        skillUsed,
        causePairUsed,
      },
    };
  }

  return {
    enabled: true,
    reasonCode: "ready",
    selectedTaskType: choice.taskType,
    probeSkill: choice.probeSkill,
    templateKey: choice.templateKey,
    topCauseLabels: labels,
    budget: {
      ...budget,
      sessionUsed,
      skillUsed,
      causePairUsed,
    },
  };
}
