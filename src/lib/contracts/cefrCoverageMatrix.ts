import { z } from "zod";

export const CEFR_COVERAGE_STAGE_ORDER = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrCoverageStage = (typeof CEFR_COVERAGE_STAGE_ORDER)[number];

export const CEFR_COVERAGE_SKILLS = [
  "speaking",
  "listening",
  "reading",
  "writing",
  "grammar",
  "vocabulary",
  "discourse",
  "pragmatics",
] as const;
export type CefrCoverageSkill = (typeof CEFR_COVERAGE_SKILLS)[number];

export const CEFR_COVERAGE_TASK_FAMILIES = [
  "read_aloud",
  "listening_comprehension",
  "reading_comprehension",
  "writing_prompt",
  "target_vocab",
  "qa_prompt",
  "role_play",
  "topic_talk",
  "filler_control",
  "speech_builder",
  "argumentation",
  "register_switch",
  "misunderstanding_repair",
] as const;
export type CefrCoverageTaskFamily = (typeof CEFR_COVERAGE_TASK_FAMILIES)[number];

export const CEFR_COVERAGE_RUBRIC_ROWS = [
  "speaking_delivery",
  "listening_grounding",
  "reading_grounding",
  "writing_clarity",
  "grammar_accuracy",
  "required_words_used",
  "contextual_vocabulary",
  "question_addressed",
  "question_answered",
  "direct_answer_first",
  "supporting_reasons",
  "main_point_detected",
  "supporting_detail_count",
  "coherence",
  "argument_structure",
  "register_control",
  "turn_taking_repair",
  "audience_fit",
] as const;
export type CefrCoverageRubricRow = (typeof CEFR_COVERAGE_RUBRIC_ROWS)[number];

export const CEFR_COVERAGE_NODE_DOMAINS = ["vocab", "grammar", "lo"] as const;
export type CefrCoverageNodeDomain = (typeof CEFR_COVERAGE_NODE_DOMAINS)[number];

export const CEFR_COVERAGE_NODE_TYPES = ["GSE_VOCAB", "GSE_GRAMMAR", "GSE_LO"] as const;
export type CefrCoverageNodeType = (typeof CEFR_COVERAGE_NODE_TYPES)[number];

const stageSchema = z.enum(CEFR_COVERAGE_STAGE_ORDER);
const skillSchema = z.enum(CEFR_COVERAGE_SKILLS);
const taskFamilySchema = z.enum(CEFR_COVERAGE_TASK_FAMILIES);
const rubricRowSchema = z.enum(CEFR_COVERAGE_RUBRIC_ROWS);
const nodeDomainSchema = z.enum(CEFR_COVERAGE_NODE_DOMAINS);
const nodeTypeSchema = z.enum(CEFR_COVERAGE_NODE_TYPES);

export const cefrCoverageNodeSelectorSchema = z.union([
  z.object({
    kind: z.literal("bundle_domain"),
    stage: stageSchema,
    domain: nodeDomainSchema,
  }),
  z.object({
    kind: z.literal("gse_node_type"),
    stage: stageSchema,
    nodeType: nodeTypeSchema,
  }),
]);

export const cefrCoverageDescriptorRowSchema = z.object({
  descriptorId: z.string().min(1),
  stage: stageSchema,
  skill: skillSchema,
  descriptor: z.string().min(1),
  nodeSelectors: z.array(cefrCoverageNodeSelectorSchema).min(1),
  taskFamilies: z.array(taskFamilySchema).min(1),
  rubricRows: z.array(rubricRowSchema).min(1),
  notes: z.string().nullable().optional(),
});

export const cefrCoverageMatrixSchema = z
  .object({
    version: z.string().min(1),
    generatedAt: z.string().min(1),
    descriptorRows: z.array(cefrCoverageDescriptorRowSchema).min(1),
  })
  .strict();

export type CefrCoverageNodeSelector = z.infer<typeof cefrCoverageNodeSelectorSchema>;
export type CefrCoverageDescriptorRow = z.infer<typeof cefrCoverageDescriptorRowSchema>;
export type CefrCoverageMatrix = z.infer<typeof cefrCoverageMatrixSchema>;

const STAGE_SKILL_DESCRIPTORS: Record<CefrCoverageStage, Record<CefrCoverageSkill, string>> = {
  A0: {
    speaking: "Speak in short guided phrases with understandable meaning.",
    listening: "Catch the main point in very short classroom audio.",
    reading: "Read short familiar lines and find key words.",
    writing: "Write short guided sentences with a clear idea.",
    grammar: "Use basic sentence order with support.",
    vocabulary: "Use core high-frequency words for daily topics.",
    discourse: "Give one clear point with simple linking.",
    pragmatics: "Use polite turn-taking in short exchanges.",
  },
  A1: {
    speaking: "Answer everyday prompts in 3-4 short sentences.",
    listening: "Understand short audio and answer direct questions.",
    reading: "Read short passages and find explicit information.",
    writing: "Write short connected responses on familiar topics.",
    grammar: "Use common sentence frames with fewer rule slips.",
    vocabulary: "Use school and home vocabulary in context.",
    discourse: "State a main point and add one support detail.",
    pragmatics: "Respond politely and keep conversational intent clear.",
  },
  A2: {
    speaking: "Sustain 45-60 second responses with clear structure.",
    listening: "Track short multi-sentence audio and extract reasons/details.",
    reading: "Understand short texts and answer inference-lite questions.",
    writing: "Write short structured responses with coherent flow.",
    grammar: "Apply core tense and agreement patterns reliably.",
    vocabulary: "Use varied topic vocabulary with mostly correct usage.",
    discourse: "Organize answer with main point, detail, and close.",
    pragmatics: "Adjust politeness and turn-taking to simple contexts.",
  },
  B1: {
    speaking: "Speak in extended turns with clear intent and support.",
    listening: "Understand connected speech and answer why/how questions.",
    reading: "Read multi-paragraph texts and identify core claims.",
    writing: "Write coherent paragraphs with clear argument direction.",
    grammar: "Control sentence complexity with stable accuracy.",
    vocabulary: "Use flexible vocabulary to explain and compare ideas.",
    discourse: "Build reasoned responses with clear coherence markers.",
    pragmatics: "Repair misunderstandings and maintain interaction quality.",
  },
  B2: {
    speaking: "Handle complex speaking tasks with balanced structure.",
    listening: "Follow nuanced audio and separate key vs supporting points.",
    reading: "Interpret argument structure and evidence in longer texts.",
    writing: "Write structured, audience-aware responses with clear logic.",
    grammar: "Maintain high control over complex grammar choices.",
    vocabulary: "Use precise vocabulary and paraphrase when needed.",
    discourse: "Sustain coherent argument flow across longer responses.",
    pragmatics: "Choose register and response style for context/audience.",
  },
  C1: {
    speaking: "Deliver advanced spoken responses with control and flexibility.",
    listening: "Extract subtle intent and stance from dense audio.",
    reading: "Interpret nuanced claims, tone, and argumentative strategy.",
    writing: "Produce advanced structured writing with clear rhetorical intent.",
    grammar: "Use complex grammar accurately under cognitive load.",
    vocabulary: "Deploy nuanced lexical choices and precise register shifts.",
    discourse: "Construct robust argumentation with clear discourse control.",
    pragmatics: "Adapt interaction strategy, register, and repair in real time.",
  },
  C2: {
    speaking: "Speak effortlessly across demanding, spontaneous tasks.",
    listening: "Comprehend subtle detail and implied meaning in rich audio.",
    reading: "Process complex texts with high-fidelity interpretation.",
    writing: "Produce polished writing with advanced argument and style control.",
    grammar: "Maintain near-error-free grammar across complex constructions.",
    vocabulary: "Use broad and precise vocabulary with context-appropriate nuance.",
    discourse: "Control discourse architecture in advanced argument tasks.",
    pragmatics: "Demonstrate audience-fit, register-switching, and repair mastery.",
  },
};

type NodeSelectorTemplate =
  | { kind: "bundle_domain"; domain: CefrCoverageNodeDomain }
  | { kind: "gse_node_type"; nodeType: CefrCoverageNodeType };

type SkillBinding = {
  nodeSelectorTemplates: NodeSelectorTemplate[];
  taskFamilies: CefrCoverageTaskFamily[];
  rubricRows: CefrCoverageRubricRow[];
};

const SKILL_BINDINGS: Record<CefrCoverageSkill, SkillBinding> = {
  speaking: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["topic_talk", "qa_prompt", "role_play", "speech_builder"],
    rubricRows: ["speaking_delivery", "question_answered", "coherence"],
  },
  listening: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["listening_comprehension"],
    rubricRows: ["listening_grounding", "question_addressed", "supporting_detail_count"],
  },
  reading: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["reading_comprehension"],
    rubricRows: ["reading_grounding", "question_addressed", "main_point_detected"],
  },
  writing: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "bundle_domain", domain: "grammar" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
      { kind: "gse_node_type", nodeType: "GSE_GRAMMAR" },
    ],
    taskFamilies: ["writing_prompt"],
    rubricRows: ["writing_clarity", "coherence", "grammar_accuracy"],
  },
  grammar: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "grammar" },
      { kind: "gse_node_type", nodeType: "GSE_GRAMMAR" },
    ],
    taskFamilies: ["writing_prompt", "qa_prompt", "reading_comprehension"],
    rubricRows: ["grammar_accuracy", "question_answered", "coherence"],
  },
  vocabulary: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "vocab" },
      { kind: "gse_node_type", nodeType: "GSE_VOCAB" },
    ],
    taskFamilies: ["target_vocab", "writing_prompt", "reading_comprehension", "topic_talk"],
    rubricRows: ["required_words_used", "contextual_vocabulary", "supporting_reasons"],
  },
  discourse: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["argumentation", "register_switch", "misunderstanding_repair"],
    rubricRows: [
      "argument_structure",
      "coherence",
      "supporting_reasons",
      "register_control",
      "turn_taking_repair",
    ],
  },
  pragmatics: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["role_play", "register_switch", "misunderstanding_repair"],
    rubricRows: [
      "register_control",
      "turn_taking_repair",
      "audience_fit",
      "direct_answer_first",
    ],
  },
};

const ADVANCED_DISCOURSE_STAGE_SET = new Set<CefrCoverageStage>(["C1", "C2"]);
const ADVANCED_DISCOURSE_TASKS_BY_SKILL: Partial<
  Record<CefrCoverageSkill, CefrCoverageTaskFamily[]>
> = {
  speaking: ["argumentation"],
  writing: ["argumentation"],
  discourse: ["argumentation", "register_switch", "misunderstanding_repair"],
  pragmatics: ["register_switch", "misunderstanding_repair"],
};

function dedupe<T>(items: T[]) {
  return Array.from(new Set(items));
}

function buildNodeSelectors(
  stage: CefrCoverageStage,
  templates: NodeSelectorTemplate[]
): CefrCoverageNodeSelector[] {
  return templates.map((template) => {
    if (template.kind === "bundle_domain") {
      return {
        kind: "bundle_domain",
        stage,
        domain: template.domain,
      };
    }
    return {
      kind: "gse_node_type",
      stage,
      nodeType: template.nodeType,
    };
  });
}

function buildDescriptorRows(): CefrCoverageDescriptorRow[] {
  const rows: CefrCoverageDescriptorRow[] = [];
  for (const stage of CEFR_COVERAGE_STAGE_ORDER) {
    for (const skill of CEFR_COVERAGE_SKILLS) {
      const binding = SKILL_BINDINGS[skill];
      const advancedFamilies = ADVANCED_DISCOURSE_STAGE_SET.has(stage)
        ? ADVANCED_DISCOURSE_TASKS_BY_SKILL[skill] || []
        : [];
      rows.push({
        descriptorId: `cefr:${stage.toLowerCase()}:${skill}`,
        stage,
        skill,
        descriptor: STAGE_SKILL_DESCRIPTORS[stage][skill],
        nodeSelectors: buildNodeSelectors(stage, binding.nodeSelectorTemplates),
        taskFamilies: dedupe([...binding.taskFamilies, ...advancedFamilies]),
        rubricRows: dedupe(binding.rubricRows),
      });
    }
  }
  return rows;
}

export const CEFR_COVERAGE_MATRIX_VERSION = "cefr-coverage.v2.2026-02-23";

export const CEFR_COVERAGE_MATRIX: CefrCoverageMatrix = cefrCoverageMatrixSchema.parse({
  version: CEFR_COVERAGE_MATRIX_VERSION,
  generatedAt: "2026-02-23T00:00:00Z",
  descriptorRows: buildDescriptorRows(),
});

export const CEFR_COVERAGE_GAP_CODES = [
  "duplicate_descriptor_id",
  "duplicate_stage_skill_mapping",
  "missing_stage_skill_mapping",
  "missing_descriptor_text",
  "missing_node_mapping",
  "missing_task_family_mapping",
  "missing_rubric_mapping",
  "unknown_task_family",
  "unknown_rubric_row",
  "node_selector_stage_mismatch",
] as const;

export type CefrCoverageGapCode = (typeof CEFR_COVERAGE_GAP_CODES)[number];

export type CefrCoverageGap = {
  code: CefrCoverageGapCode;
  descriptorId: string | null;
  stage: CefrCoverageStage | null;
  skill: CefrCoverageSkill | null;
  message: string;
};

export type CefrCoverageValidationResult = {
  gaps: CefrCoverageGap[];
};

function addGap(
  gaps: CefrCoverageGap[],
  code: CefrCoverageGapCode,
  row: { descriptorId?: string; stage?: CefrCoverageStage; skill?: CefrCoverageSkill } | null,
  message: string
) {
  gaps.push({
    code,
    descriptorId: row?.descriptorId ?? null,
    stage: row?.stage ?? null,
    skill: row?.skill ?? null,
    message,
  });
}

export function validateCefrCoverageMatrix(matrixInput: CefrCoverageMatrix): CefrCoverageValidationResult {
  const matrix = cefrCoverageMatrixSchema.parse(matrixInput);
  const gaps: CefrCoverageGap[] = [];
  const knownTaskFamilies = new Set<CefrCoverageTaskFamily>(CEFR_COVERAGE_TASK_FAMILIES);
  const knownRubricRows = new Set<CefrCoverageRubricRow>(CEFR_COVERAGE_RUBRIC_ROWS);
  const descriptorIds = new Set<string>();
  const stageSkillKeys = new Set<string>();

  for (const row of matrix.descriptorRows) {
    const stageSkillKey = `${row.stage}:${row.skill}`;

    if (descriptorIds.has(row.descriptorId)) {
      addGap(gaps, "duplicate_descriptor_id", row, `Descriptor ID ${row.descriptorId} is duplicated.`);
    } else {
      descriptorIds.add(row.descriptorId);
    }

    if (stageSkillKeys.has(stageSkillKey)) {
      addGap(
        gaps,
        "duplicate_stage_skill_mapping",
        row,
        `Stage/skill mapping ${stageSkillKey} appears more than once.`
      );
    } else {
      stageSkillKeys.add(stageSkillKey);
    }

    if (!row.descriptor.trim()) {
      addGap(gaps, "missing_descriptor_text", row, "Descriptor text is empty.");
    }

    if (row.nodeSelectors.length === 0) {
      addGap(gaps, "missing_node_mapping", row, "At least one node selector is required.");
    }

    if (row.taskFamilies.length === 0) {
      addGap(gaps, "missing_task_family_mapping", row, "At least one task family is required.");
    }

    if (row.rubricRows.length === 0) {
      addGap(gaps, "missing_rubric_mapping", row, "At least one rubric row is required.");
    }

    for (const selector of row.nodeSelectors) {
      if (selector.stage !== row.stage) {
        addGap(
          gaps,
          "node_selector_stage_mismatch",
          row,
          `Node selector stage ${selector.stage} does not match descriptor stage ${row.stage}.`
        );
      }
    }

    for (const family of row.taskFamilies) {
      if (!knownTaskFamilies.has(family)) {
        addGap(gaps, "unknown_task_family", row, `Unknown task family ${family}.`);
      }
    }

    for (const rubricRow of row.rubricRows) {
      if (!knownRubricRows.has(rubricRow)) {
        addGap(gaps, "unknown_rubric_row", row, `Unknown rubric row ${rubricRow}.`);
      }
    }
  }

  for (const stage of CEFR_COVERAGE_STAGE_ORDER) {
    for (const skill of CEFR_COVERAGE_SKILLS) {
      const key = `${stage}:${skill}`;
      if (!stageSkillKeys.has(key)) {
        addGap(
          gaps,
          "missing_stage_skill_mapping",
          { stage, skill },
          `Missing descriptor mapping for stage ${stage}, skill ${skill}.`
        );
      }
    }
  }

  return { gaps };
}

export type CefrCoverageReport = {
  version: string;
  generatedAt: string;
  matrixGeneratedAt: string;
  summary: {
    descriptorRows: number;
    expectedDescriptorRows: number;
    totalGaps: number;
    releaseBlocker: boolean;
  };
  byStage: Array<{
    stage: CefrCoverageStage;
    descriptorRows: number;
    skillsCovered: CefrCoverageSkill[];
    taskFamilies: CefrCoverageTaskFamily[];
    rubricRows: CefrCoverageRubricRow[];
  }>;
  gaps: CefrCoverageGap[];
};

export function buildCefrCoverageReport(matrixInput: CefrCoverageMatrix = CEFR_COVERAGE_MATRIX): CefrCoverageReport {
  const matrix = cefrCoverageMatrixSchema.parse(matrixInput);
  const validation = validateCefrCoverageMatrix(matrix);

  const byStage = CEFR_COVERAGE_STAGE_ORDER.map((stage) => {
    const rows = matrix.descriptorRows.filter((row) => row.stage === stage);
    return {
      stage,
      descriptorRows: rows.length,
      skillsCovered: dedupe(rows.map((row) => row.skill)),
      taskFamilies: dedupe(rows.flatMap((row) => row.taskFamilies)),
      rubricRows: dedupe(rows.flatMap((row) => row.rubricRows)),
    };
  });

  const expectedDescriptorRows = CEFR_COVERAGE_STAGE_ORDER.length * CEFR_COVERAGE_SKILLS.length;

  return {
    version: matrix.version,
    generatedAt: new Date().toISOString(),
    matrixGeneratedAt: matrix.generatedAt,
    summary: {
      descriptorRows: matrix.descriptorRows.length,
      expectedDescriptorRows,
      totalGaps: validation.gaps.length,
      releaseBlocker: validation.gaps.length > 0,
    },
    byStage,
    gaps: validation.gaps,
  };
}
