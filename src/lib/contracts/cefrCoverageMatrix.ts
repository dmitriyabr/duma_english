import { z } from "zod";

export const CEFR_COVERAGE_STAGE_ORDER = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrCoverageStage = (typeof CEFR_COVERAGE_STAGE_ORDER)[number];

export const CEFR_COVERAGE_SKILLS = [
  "pronunciation",
  "fluency",
  "tempo_control",
  "vocabulary",
  "task_completion",
] as const;
export type CefrCoverageSkill = (typeof CEFR_COVERAGE_SKILLS)[number];

export const CEFR_COVERAGE_TASK_FAMILIES = [
  "read_aloud",
  "target_vocab",
  "qa_prompt",
  "role_play",
  "topic_talk",
  "filler_control",
  "speech_builder",
] as const;
export type CefrCoverageTaskFamily = (typeof CEFR_COVERAGE_TASK_FAMILIES)[number];

export const CEFR_COVERAGE_RUBRIC_ROWS = [
  "reference_coverage",
  "accuracy_score",
  "fluency_score",
  "required_words_used",
  "contextual_usage",
  "greeting",
  "questioning",
  "politeness",
  "question_answered",
  "direct_answer_first",
  "supporting_reasons",
  "main_point_detected",
  "supporting_detail_count",
  "coherence",
  "filler_density",
  "steady_flow",
  "self_corrections",
  "parts_present",
  "order_quality",
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
    pronunciation: "Produce high-frequency classroom and daily-life words clearly.",
    fluency: "Speak in short chunks with teacher-like prompts and minimal silence.",
    tempo_control: "Keep a steady beginner pace on 1-2 sentence responses.",
    vocabulary: "Use a core bank of frequent words in guided speaking.",
    task_completion: "Follow a simple speaking instruction and complete it.",
  },
  A1: {
    pronunciation: "Say common words and short phrases with understandable stress.",
    fluency: "Give 3-4 sentence answers with fewer restarts.",
    tempo_control: "Maintain stable pace in short monologues and Q&A.",
    vocabulary: "Use thematic school-life vocabulary in context.",
    task_completion: "Answer prompts directly and add one supporting detail.",
  },
  A2: {
    pronunciation: "Speak clearly enough for unfamiliar listeners in routine topics.",
    fluency: "Sustain 45-60 second responses with logical flow.",
    tempo_control: "Control pauses and pace during extended turns.",
    vocabulary: "Use varied and precise topic vocabulary with few misuse errors.",
    task_completion: "Complete role-play and structured prompts with relevance.",
  },
  B1: {
    pronunciation: "Deliver clear intelligible speech in longer presentations.",
    fluency: "Speak with natural rhythm in 60-90 second mini talks.",
    tempo_control: "Control pacing strategically for emphasis and clarity.",
    vocabulary: "Use flexible vocabulary to explain, compare, and persuade.",
    task_completion: "Build coherent public-facing responses with structure.",
  },
  B2: {
    pronunciation: "Maintain clear and accurate pronunciation for unfamiliar topics.",
    fluency: "Sustain extended speech with minimal hesitation.",
    tempo_control: "Adapt pace and pauses intentionally for emphasis.",
    vocabulary: "Use precise topic-specific vocabulary and paraphrase effectively.",
    task_completion: "Handle complex prompts with balanced structure and relevance.",
  },
  C1: {
    pronunciation: "Speak with consistent clarity and advanced control of stress patterns.",
    fluency: "Deliver long responses smoothly with natural transitions.",
    tempo_control: "Use dynamic pacing to support argument and audience understanding.",
    vocabulary: "Deploy nuanced vocabulary, idiomatic range, and precise register.",
    task_completion: "Address abstract and multi-part tasks with strong coherence.",
  },
  C2: {
    pronunciation: "Maintain near-native clarity and intelligibility under pressure.",
    fluency: "Speak effortlessly in extended discourse and spontaneous exchanges.",
    tempo_control: "Control rhythm and pacing strategically for rhetorical effect.",
    vocabulary: "Use sophisticated lexical range with accuracy and flexibility.",
    task_completion: "Deliver polished, audience-aware responses for advanced tasks.",
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
  pronunciation: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["read_aloud", "filler_control"],
    rubricRows: ["reference_coverage", "accuracy_score", "fluency_score"],
  },
  fluency: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["topic_talk", "qa_prompt", "speech_builder"],
    rubricRows: [
      "main_point_detected",
      "supporting_detail_count",
      "coherence",
      "question_answered",
      "direct_answer_first",
      "supporting_reasons",
    ],
  },
  tempo_control: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["filler_control", "speech_builder", "topic_talk"],
    rubricRows: ["filler_density", "steady_flow", "self_corrections", "order_quality"],
  },
  vocabulary: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "vocab" },
      { kind: "gse_node_type", nodeType: "GSE_VOCAB" },
    ],
    taskFamilies: ["target_vocab", "topic_talk", "qa_prompt"],
    rubricRows: ["required_words_used", "contextual_usage"],
  },
  task_completion: {
    nodeSelectorTemplates: [
      { kind: "bundle_domain", domain: "grammar" },
      { kind: "bundle_domain", domain: "lo" },
      { kind: "gse_node_type", nodeType: "GSE_GRAMMAR" },
      { kind: "gse_node_type", nodeType: "GSE_LO" },
    ],
    taskFamilies: ["qa_prompt", "role_play", "speech_builder"],
    rubricRows: [
      "question_answered",
      "direct_answer_first",
      "supporting_reasons",
      "greeting",
      "questioning",
      "politeness",
      "parts_present",
      "order_quality",
    ],
  },
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
      rows.push({
        descriptorId: `cefr:${stage.toLowerCase()}:${skill}`,
        stage,
        skill,
        descriptor: STAGE_SKILL_DESCRIPTORS[stage][skill],
        nodeSelectors: buildNodeSelectors(stage, binding.nodeSelectorTemplates),
        taskFamilies: dedupe(binding.taskFamilies),
        rubricRows: dedupe(binding.rubricRows),
      });
    }
  }
  return rows;
}

export const CEFR_COVERAGE_MATRIX_VERSION = "cefr-coverage.v1.2026-02-17";

export const CEFR_COVERAGE_MATRIX: CefrCoverageMatrix = cefrCoverageMatrixSchema.parse({
  version: CEFR_COVERAGE_MATRIX_VERSION,
  generatedAt: "2026-02-17T00:00:00Z",
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
