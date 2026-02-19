import { z } from "zod";
import { buildTaskTemplate } from "./taskTemplates";
import {
  extractReadingPassage,
  extractReadingQuestion,
  extractReferenceText,
  extractRequiredWords,
} from "./taskText";
import { chatJson } from "./llm";
import { config } from "./config";
import { buildDisambiguationPromptGuidance, type DisambiguationProbePlan } from "./causal/disambiguationProbe";

const generatedTaskSchema = z.object({
  task_type: z.string().min(2),
  instruction: z.string().min(20).max(420),
  constraints: z.object({
    minSeconds: z.number().int().min(5).max(300),
    maxSeconds: z.number().int().min(10).max(300),
  }),
  maxDurationSec: z.number().int().min(10).max(300),
  assessmentMode: z.enum(["pa", "stt"]),
  expected_artifacts: z.array(z.string()).max(12),
  scoring_hooks: z.array(z.string()).max(12),
  estimated_difficulty: z.number().min(0).max(100),
});

type GenerateTaskSpecInput = {
  taskType: string;
  stage: string;
  ageBand: string;
  targetWords: string[];
  targetNodeIds: string[];
  /** Human-readable learning objectives (same order as targetNodeIds). Shown to LLM instead of raw IDs. */
  targetNodeLabels?: string[];
  /** Node types in same order as targetNodeIds: GSE_VOCAB, GSE_GRAMMAR, GSE_LO. Used to split words vs objectives. */
  targetNodeTypes?: string[];
  focusSkills: string[];
  plannerReason: string;
  primaryGoal: string;
  recentPrompts?: string[];
  domainStages?: {
    vocab?: string;
    grammar?: string;
  };
  disambiguationProbe?: DisambiguationProbePlan;
};

export type GeneratedTaskSpec = {
  taskType: string;
  prompt: string;
  constraints: { minSeconds: number; maxSeconds: number };
  maxDurationSec: number;
  assessmentMode: "pa" | "stt";
  expectedArtifacts: string[];
  scoringHooks: string[];
  estimatedDifficulty: number;
  targetNodes: string[];
  fallbackUsed: boolean;
  fallbackReason?: string;
  model?: string;
};

function effectiveTaskType(input: GenerateTaskSpecInput) {
  if (input.disambiguationProbe?.enabled && input.disambiguationProbe.selectedTaskType) {
    return input.disambiguationProbe.selectedTaskType;
  }
  return input.taskType;
}

function fallbackTaskSpec(input: GenerateTaskSpecInput): GeneratedTaskSpec {
  const taskType = effectiveTaskType(input);
  const template = buildTaskTemplate(taskType, {
    targetWords: input.targetWords,
    stage: input.stage,
    reason: input.plannerReason,
    focusSkills: input.focusSkills,
  });
  const fallbackVariants: Record<string, string[]> = {
    read_aloud: [
      "Read this aloud clearly: 'I study English at school and practice with my friends.'",
      "Read this aloud clearly: 'Every day I learn new words and use them in class.'",
      "Read this aloud clearly: 'Our class works together, asks questions, and solves problems.'",
    ],
    reading_comprehension: [
      "Read the passage and answer in 3-4 sentences.\nPassage: Musa waters the school garden every morning so vegetables can grow well in dry weather.\nQuestion: Why does Musa water the school garden every morning?",
      "Read the passage and answer in 3-4 sentences.\nPassage: Amina reads a short chapter each evening and writes two new words in her notebook.\nQuestion: How does Amina use reading to improve her English?",
      "Read the passage and answer in 3-4 sentences.\nPassage: The class planted trees around the playground because shade helps students rest after games.\nQuestion: Why did the class plant trees around the playground?",
    ],
    writing_prompt: [
      "Write 5-7 sentences about a school challenge you solved. Include the problem, your action, and the result.",
      "Write 6 sentences about helping a classmate. Explain what happened, what you said, and what changed.",
      "Write a short paragraph about your study plan this week. Include one obstacle and how you handled it.",
    ],
    target_vocab: [
      `Use these words in a short talk: ${input.targetWords.slice(0, 4).join(", ") || "school, learn, friend, goal"}.`,
      `Make 3-4 sentences using these words: ${input.targetWords.slice(0, 4).join(", ") || "plan, study, team, improve"}.`,
      `Speak about your day and include these words: ${input.targetWords.slice(0, 4).join(", ") || "homework, class, read, practice"}.`,
    ],
    topic_talk: [
      "Talk about a school activity you enjoy and explain why it helps you.",
      "Tell us about a challenge you solved this week and what you learned.",
      "Talk about your favorite subject and give one real example.",
    ],
    qa_prompt: [
      "Question: What helps you learn faster? Give your answer and one example.",
      "Question: How do you prepare for class? Answer in 3-4 sentences.",
      "Question: What do you do after school to improve your English?",
    ],
    role_play: [
      "Role-play: Welcome a new classmate and ask two friendly questions.",
      "Role-play: Ask your teacher for help politely and explain your problem.",
      "Role-play: Invite a friend to study and agree on a plan.",
    ],
    filler_control: [
      "Speak about your weekend clearly and avoid filler words like 'um' and 'uh'.",
      "Talk for 30-45 seconds about your favorite game without filler words.",
      "Explain your morning routine with clear pauses and no filler words.",
    ],
    speech_builder: [
      "Build a short speech: topic, main idea, one example, clear ending.",
      "Give a 4-part mini speech: start, key point, example, finish.",
      "Speak in 4 steps: topic, idea, example, ending.",
    ],
    argumentation: [
      "Take a position on school uniforms and give two reasons, one counterargument, and a conclusion.",
      "Argue whether homework should be reduced. Include claim, reasons, counterargument, and conclusion.",
      "Choose one side on screen time limits and defend it with reasons and one rebuttal.",
    ],
    register_switch: [
      "Explain a late-homework issue twice: first to your teacher formally, then to your friend informally.",
      "Give the same school request in two styles: formal for a principal, conversational for a classmate.",
      "Switch register: formal explanation for staff, then casual version for a friend.",
    ],
    misunderstanding_repair: [
      "Your partner misunderstood your plan. Clarify, rephrase, check understanding, and agree next steps.",
      "Repair a misunderstanding in conversation: explain again, verify understanding, and close with agreement.",
      "Role-play confusion recovery: clarify intent, restate key point, ask if it is clear, and confirm action.",
    ],
  };
  const variants = fallbackVariants[taskType] || [];
  const selectedPrompt = variants.find((candidate) => !isTooSimilarPrompt(candidate, input.recentPrompts || []));
  const prompt = selectedPrompt || template.prompt;
  return {
    taskType: template.type,
    prompt,
    constraints: template.constraints,
    maxDurationSec: template.maxDurationSec,
    assessmentMode: template.assessmentMode,
    expectedArtifacts:
      taskType === "writing_prompt"
        ? ["transcript", "task_completion", "writing_metrics"]
        : ["transcript", "task_completion", "speech_metrics"],
    scoringHooks: input.focusSkills.slice(0, 3),
    estimatedDifficulty: input.stage === "A0" ? 30 : input.stage === "A1" ? 45 : input.stage === "A2" ? 58 : 70,
    targetNodes: input.targetNodeIds.slice(0, 6),
    fallbackUsed: true,
    fallbackReason: "deterministic_template",
  };
}

function coerceMode(value: unknown, taskType: string): "pa" | "stt" {
  if (taskType === "read_aloud") return "pa";
  if (value === "stt") return "stt";
  return "stt";
}

function coerceDifficulty(value: unknown, stage: string) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    const fromNumber = Number(normalized);
    if (Number.isFinite(fromNumber)) return Math.max(0, Math.min(100, fromNumber));
    if (normalized === "easy") return 35;
    if (normalized === "medium") return 55;
    if (normalized === "hard") return 78;
  }
  if (stage === "A0") return 30;
  if (stage === "A1") return 45;
  if (stage === "A2") return 58;
  if (stage === "B1") return 70;
  if (stage === "B2") return 78;
  if (stage === "C1") return 86;
  return 92;
}

function coerceStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function includesBannedPhrase(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const banned = [
    "read this short story about a team playing a game",
    "try to speak clearly and use good expression",
  ];
  return banned.some((phrase) => normalized.includes(phrase));
}

function normalizePromptText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTooSimilarPrompt(prompt: string, recentPrompts: string[]) {
  const normalized = normalizePromptText(prompt);
  if (!normalized) return false;
  const tokens = new Set(normalized.split(" ").filter((v) => v.length > 2));
  for (const previous of recentPrompts) {
    const prev = normalizePromptText(previous);
    if (!prev) continue;
    if (prev === normalized) return true;
    const prevTokens = new Set(prev.split(" ").filter((v) => v.length > 2));
    if (prevTokens.size === 0 || tokens.size === 0) continue;
    let intersect = 0;
    for (const token of tokens) {
      if (prevTokens.has(token)) intersect += 1;
    }
    const overlap = intersect / Math.max(tokens.size, prevTokens.size);
    if (overlap >= 0.82) return true;
  }
  return false;
}

function taskTypeQualityGuidance(input: GenerateTaskSpecInput) {
  const taskType = effectiveTaskType(input);
  if (taskType === "read_aloud") {
    return [
      "Task quality rules for read_aloud:",
      "1) Instruction must contain one exact sentence in quotes.",
      "2) That quoted sentence must be 6-14 words, everyday school/life English, A-level appropriate.",
      "3) Do not use generic filler text like 'short story' or 'team playing a game'.",
      "4) Format exactly: Read this aloud clearly: '...'.",
    ];
  }
  if (taskType === "target_vocab") {
    return [
      "Task quality rules for target_vocab:",
      "1) Include explicit word list in instruction.",
      "2) Use at least 2 provided target words in that list.",
      "3) Keep task concrete and child-friendly.",
    ];
  }
  if (taskType === "reading_comprehension") {
    return [
      "Task quality rules for reading_comprehension:",
      "1) Instruction must include both 'Passage:' and 'Question:' sections.",
      "2) Passage should be 1-2 short sentences with concrete school/life context.",
      "3) Question must require comprehension (why/how/what) and answerable from passage content.",
      "4) Require 3-4 sentence response grounded in passage details.",
    ];
  }
  if (taskType === "writing_prompt") {
    return [
      "Task quality rules for writing_prompt:",
      "1) Require 5-7 sentence written response about a concrete school/life context.",
      "2) Ask for situation -> action -> result structure.",
      "3) Encourage clear connectors (because, then, finally) and full sentences.",
    ];
  }
  if (taskType === "speech_builder") {
    return [
      "Task quality rules for speech_builder:",
      "1) Use child wording: topic, main idea, one example, clear ending.",
      "2) Avoid method terms (hook, point, close).",
    ];
  }
  if (taskType === "argumentation") {
    return [
      "Task quality rules for argumentation:",
      "1) Require clear position, at least two reasons, one counterargument, and a conclusion.",
      "2) Keep topic age-appropriate and concrete.",
      "3) Instruction should encourage evidence-based explanation, not single-sentence opinions.",
    ];
  }
  if (taskType === "register_switch") {
    return [
      "Task quality rules for register_switch:",
      "1) Require two audience contexts in one task (formal + conversational).",
      "2) Explicitly mention register shift/switch.",
      "3) Keep scenario realistic for school-age learners.",
    ];
  }
  if (taskType === "misunderstanding_repair") {
    return [
      "Task quality rules for misunderstanding_repair:",
      "1) Include misunderstanding context and explicit repair steps.",
      "2) Require clarify/rephrase/check-understanding behavior.",
      "3) End with aligned next action or confirmation.",
    ];
  }
  return [
    "Task quality rules:",
    "1) Make instruction concrete, age-appropriate, and immediately actionable.",
    "2) Avoid vague generic wording.",
  ];
}

function validatePromptQuality(spec: GeneratedTaskSpec, input: GenerateTaskSpecInput) {
  const taskType = effectiveTaskType(input);
  const prompt = (spec.prompt || "").trim();
  if (!prompt) return { ok: false, reason: "empty_prompt" };
  if (includesBannedPhrase(prompt)) return { ok: false, reason: "banned_generic_phrase" };
  if (countWords(prompt) < 6) return { ok: false, reason: "prompt_too_short" };

  if (taskType === "read_aloud") {
    const reference = extractReferenceText(prompt);
    if (!reference) return { ok: false, reason: "missing_reference_text" };
    const words = countWords(reference);
    if (words < 6 || words > 14) return { ok: false, reason: "bad_reference_length" };
    if (/short story|team playing a game/i.test(reference)) {
      return { ok: false, reason: "low_quality_reference_text" };
    }
  }

  if (taskType === "reading_comprehension") {
    const passage = extractReadingPassage(prompt);
    const question = extractReadingQuestion(prompt);
    if (!passage) return { ok: false, reason: "missing_reading_passage" };
    if (!question) return { ok: false, reason: "missing_reading_question" };
    const passageWords = countWords(passage);
    if (passageWords < 12 || passageWords > 45) {
      return { ok: false, reason: "reading_passage_length_out_of_range" };
    }
    if (!/\\?$/.test(question) || countWords(question) < 5) {
      return { ok: false, reason: "reading_question_quality_low" };
    }
  }

  if (taskType === "writing_prompt") {
    const words = countWords(prompt);
    if (words < 12) return { ok: false, reason: "writing_prompt_too_short" };
    const normalized = normalizePromptText(prompt);
    const hasStructureCue =
      normalized.includes("situation") ||
      normalized.includes("problem") ||
      normalized.includes("action") ||
      normalized.includes("result");
    if (!hasStructureCue) return { ok: false, reason: "writing_structure_cues_missing" };
  }

  if (taskType === "target_vocab" && input.targetWords.length >= 2) {
    const parsedWords = extractRequiredWords(prompt);
    const provided = new Set(input.targetWords.map((w) => w.toLowerCase().trim()));
    const overlap = parsedWords.filter((w) => provided.has(w)).length;
    if (overlap < 2) return { ok: false, reason: "target_words_not_respected" };
  }

  if (taskType === "argumentation") {
    const normalized = normalizePromptText(prompt);
    const cueCount =
      (normalized.includes("position") ? 1 : 0) +
      (normalized.includes("reason") ? 1 : 0) +
      (normalized.includes("counterargument") || normalized.includes("counter argument") ? 1 : 0) +
      (normalized.includes("conclusion") ? 1 : 0);
    if (cueCount < 3) return { ok: false, reason: "argumentation_structure_missing" };
  }

  if (taskType === "register_switch") {
    const normalized = normalizePromptText(prompt);
    const hasFormal = normalized.includes("formal");
    const hasConversational =
      normalized.includes("conversational") || normalized.includes("informal");
    const hasSwitchCue = normalized.includes("switch") || normalized.includes("register");
    if (!(hasFormal && hasConversational && hasSwitchCue)) {
      return { ok: false, reason: "register_switch_cues_missing" };
    }
  }

  if (taskType === "misunderstanding_repair") {
    const normalized = normalizePromptText(prompt);
    const hasRepairCue =
      normalized.includes("clarify") ||
      normalized.includes("rephrase") ||
      normalized.includes("misunderstand");
    if (!hasRepairCue) return { ok: false, reason: "repair_cues_missing" };
  }

  return { ok: true, reason: null as string | null };
}

function normalizeGeneratedPayload(
  payload: unknown,
  input: GenerateTaskSpecInput,
  fallback: GeneratedTaskSpec
): GeneratedTaskSpec | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const taskType = effectiveTaskType(input);
  const instruction =
    typeof row.instruction === "string" && row.instruction.trim().length >= 20
      ? row.instruction.trim()
      : fallback.prompt;
  const constraintsRaw = row.constraints as Record<string, unknown> | undefined;
  const minSeconds =
    typeof constraintsRaw?.minSeconds === "number" ? constraintsRaw.minSeconds : fallback.constraints.minSeconds;
  const maxSeconds =
    typeof constraintsRaw?.maxSeconds === "number" ? constraintsRaw.maxSeconds : fallback.constraints.maxSeconds;
  const maxDurationSec =
    typeof row.maxDurationSec === "number"
      ? row.maxDurationSec
      : Math.max(maxSeconds, fallback.maxDurationSec);
  const expectedArtifacts = coerceStringArray(row.expected_artifacts);
  const scoringHooks = coerceStringArray(row.scoring_hooks);

  return {
    taskType,
    prompt: instruction,
    constraints: {
      minSeconds: Math.max(5, Math.min(300, Math.round(minSeconds))),
      maxSeconds: Math.max(10, Math.min(300, Math.round(maxSeconds))),
    },
    maxDurationSec: Math.max(10, Math.min(300, Math.round(maxDurationSec))),
    assessmentMode: coerceMode(row.assessmentMode, taskType),
    expectedArtifacts: expectedArtifacts.length ? expectedArtifacts.slice(0, 12) : fallback.expectedArtifacts,
    scoringHooks: scoringHooks.length ? scoringHooks.slice(0, 12) : fallback.scoringHooks,
    estimatedDifficulty: Math.round(coerceDifficulty(row.estimated_difficulty, input.stage)),
    targetNodes: input.targetNodeIds.slice(0, 8),
    fallbackUsed: false,
  };
}

export async function generateTaskSpec(input: GenerateTaskSpecInput): Promise<GeneratedTaskSpec> {
  const apiKey = config.openai.apiKey;
  const model = config.openai.model;
  const fallback = fallbackTaskSpec(input);
  const taskType = effectiveTaskType(input);
  if (!apiKey) {
    console.warn(JSON.stringify({ event: "task_gen_fallback", reason: "no_openai_api_key", taskType }));
    return fallback;
  }

  const labels = input.targetNodeLabels?.filter(Boolean) ?? [];
  const types = input.targetNodeTypes ?? [];
  const hasLabels = labels.length > 0 && labels.length === input.targetNodeIds.length;
  const hasTypes = types.length === input.targetNodeIds.length;
  const vocabIndices = hasTypes ? types.map((t, i) => (t === "GSE_VOCAB" ? i : -1)).filter((i) => i >= 0) : [];
  const nonVocabIndices = hasTypes ? types.map((t, i) => (t !== "GSE_VOCAB" ? i : -1)).filter((i) => i >= 0) : [];
  const wordsForLearner =
    input.targetWords.length > 0
      ? input.targetWords
      : hasLabels && vocabIndices.length > 0
        ? vocabIndices.map((i) => labels[i]!).filter(Boolean)
        : [];
  const objectiveLabels =
    hasLabels && nonVocabIndices.length > 0 ? nonVocabIndices.map((i) => labels[i]!).filter(Boolean) : [];
  const wordsLine =
    wordsForLearner.length > 0
      ? `Words the learner must use in their answer: ${wordsForLearner.join(", ")}.`
      : null;
  const objectivesBlock =
    objectiveLabels.length > 0
      ? [
          "Learning objectives the learner should demonstrate (design the task so the learner can show this in their answer):",
          ...objectiveLabels.map((desc, i) => `${i + 1}) ${desc}`),
        ].join("\n")
      : null;

  const domainLevelLines: string[] = [];
  if (input.domainStages) {
    if (input.domainStages.vocab) domainLevelLines.push(`Vocabulary level: ${input.domainStages.vocab} (use vocabulary appropriate for this level)`);
    if (input.domainStages.grammar) domainLevelLines.push(`Grammar level: ${input.domainStages.grammar} (use sentence structures appropriate for this level)`);
  }

  const prompt = [
    "Generate one English task for a child learner (speaking or writing depending on required task type).",
    "Output JSON only with keys: task_type,instruction,constraints,maxDurationSec,assessmentMode,expected_artifacts,scoring_hooks,estimated_difficulty.",
    "Use simple child-friendly language and no method jargon.",
    "Keep instruction under 45 words.",
    `Stage: ${input.stage}`,
    `Age band: ${input.ageBand}`,
    `Task type required: ${taskType}`,
    `Primary goal: ${input.primaryGoal}`,
    ...domainLevelLines,
    ...(wordsLine ? [wordsLine] : []),
    ...(objectivesBlock ? [objectivesBlock] : []),
    `Focus skills: ${input.focusSkills.join(", ") || "speaking"}`,
    `Planner reason: ${input.plannerReason}`,
    `Avoid repeating recent prompts: ${(input.recentPrompts || []).slice(0, 5).join(" || ") || "none"}`,
    taskType === "read_aloud"
      ? "For read_aloud: instruction MUST include exact text to read in quotes, e.g. Read this aloud clearly: '...'."
      : taskType === "reading_comprehension"
      ? "For reading_comprehension: instruction MUST include both sections with exact labels: 'Passage:' and 'Question:'."
      : "For non-read_aloud: do not ask learner to read a reference sentence.",
    ...taskTypeQualityGuidance(input),
    ...buildDisambiguationPromptGuidance(input.disambiguationProbe || {
      enabled: false,
      reasonCode: "not_triggered",
      selectedTaskType: null,
      probeSkill: null,
      templateKey: null,
      topCauseLabels: ["unknown", "unknown"],
      budget: {
        sessionWindowMinutes: 0,
        maxPerSession: 0,
        maxPerSkillPerSession: 0,
        maxPerCausePairPerSession: 0,
        sessionUsed: 0,
        skillUsed: 0,
        causePairUsed: 0,
      },
    }),
  ].join("\n");

  const systemContent =
    "You design child English speaking tasks. Return strict JSON only with requested schema. No markdown.";

  try {
    const content = await chatJson(systemContent, prompt, {
      openaiApiKey: apiKey,
      model,
      temperature: 0.25,
      maxTokens: 420,
    });
    if (!content || !content.trim()) {
      console.warn(JSON.stringify({ event: "task_gen_fallback", reason: "openai_empty_content", taskType }));
      return { ...fallback, fallbackReason: "openai_empty_content" };
    }
    const json = JSON.parse(content);
    const normalized = normalizeGeneratedPayload(json, input, fallback);
    if (!normalized) {
      console.warn(JSON.stringify({ event: "task_gen_fallback", reason: "openai_invalid_payload", taskType }));
      return { ...fallback, fallbackReason: "openai_invalid_payload" };
    }
    if (normalized.taskType === "read_aloud" && !extractReferenceText(normalized.prompt)) {
      console.warn(JSON.stringify({ event: "task_gen_fallback", reason: "openai_missing_read_aloud_reference", taskType }));
      return { ...fallback, fallbackReason: "openai_missing_read_aloud_reference" };
    }
    if (isTooSimilarPrompt(normalized.prompt, input.recentPrompts || [])) {
      console.warn(JSON.stringify({ event: "task_gen_fallback", reason: "openai_repeated_prompt", taskType }));
      return { ...fallback, fallbackReason: "openai_repeated_prompt" };
    }
    const quality = validatePromptQuality(normalized, input);
    if (!quality.ok) {
      const reason = `openai_low_quality_${quality.reason || "prompt"}`;
      console.warn(JSON.stringify({ event: "task_gen_fallback", reason, taskType }));
      return { ...fallback, fallbackReason: reason };
    }
    const parsed = generatedTaskSchema.parse({
      task_type: normalized.taskType,
      instruction: normalized.prompt,
      constraints: normalized.constraints,
      maxDurationSec: normalized.maxDurationSec,
      assessmentMode: normalized.assessmentMode,
      expected_artifacts: normalized.expectedArtifacts,
      scoring_hooks: normalized.scoringHooks,
      estimated_difficulty: normalized.estimatedDifficulty,
    });
    return {
      taskType: parsed.task_type,
      prompt: parsed.instruction,
      constraints: parsed.constraints,
      maxDurationSec: parsed.maxDurationSec,
      assessmentMode: parsed.assessmentMode,
      expectedArtifacts: parsed.expected_artifacts,
      scoringHooks: parsed.scoring_hooks,
      estimatedDifficulty: parsed.estimated_difficulty,
      targetNodes: input.targetNodeIds.slice(0, 8),
      fallbackUsed: false,
      model,
    };
  } catch (err) {
    console.warn(JSON.stringify({
      event: "task_gen_fallback",
      reason: "openai_exception",
      taskType,
      error: err instanceof Error ? err.message : String(err),
    }));
    return { ...fallback, fallbackReason: "openai_exception" };
  }
}
