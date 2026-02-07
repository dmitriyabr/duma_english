import { z } from "zod";
import { buildTaskTemplate } from "./taskTemplates";
import { extractReferenceText, extractRequiredWords } from "./taskText";
import { chatJson } from "./llm";

const generatedTaskSchema = z.object({
  task_type: z.string().min(2),
  instruction: z.string().min(20).max(420),
  constraints: z.object({
    minSeconds: z.number().int().min(5).max(120),
    maxSeconds: z.number().int().min(10).max(180),
  }),
  maxDurationSec: z.number().int().min(10).max(120),
  assessmentMode: z.enum(["pa", "stt"]),
  expected_artifacts: z.array(z.string()).max(12),
  scoring_hooks: z.array(z.string()).max(12),
  estimated_difficulty: z.number().min(0).max(100),
  target_nodes: z.array(z.string()).max(8),
});

type GenerateTaskSpecInput = {
  taskType: string;
  stage: string;
  ageBand: string;
  targetWords: string[];
  targetNodeIds: string[];
  /** Human-readable learning objectives (same order as targetNodeIds). Shown to LLM instead of raw IDs. */
  targetNodeLabels?: string[];
  focusSkills: string[];
  plannerReason: string;
  primaryGoal: string;
  recentPrompts?: string[];
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

function fallbackTaskSpec(input: GenerateTaskSpecInput): GeneratedTaskSpec {
  const template = buildTaskTemplate(input.taskType, {
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
  };
  const variants = fallbackVariants[input.taskType] || [];
  const selectedPrompt = variants.find((candidate) => !isTooSimilarPrompt(candidate, input.recentPrompts || []));
  const prompt = selectedPrompt || template.prompt;
  return {
    taskType: template.type,
    prompt,
    constraints: template.constraints,
    maxDurationSec: template.maxDurationSec,
    assessmentMode: template.assessmentMode,
    expectedArtifacts: [
      "transcript",
      "task_completion",
      "speech_metrics",
    ],
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
  if (input.taskType === "read_aloud") {
    return [
      "Task quality rules for read_aloud:",
      "1) Instruction must contain one exact sentence in quotes.",
      "2) That quoted sentence must be 6-14 words, everyday school/life English, A-level appropriate.",
      "3) Do not use generic filler text like 'short story' or 'team playing a game'.",
      "4) Format exactly: Read this aloud clearly: '...'.",
    ];
  }
  if (input.taskType === "target_vocab") {
    return [
      "Task quality rules for target_vocab:",
      "1) Include explicit word list in instruction.",
      "2) Use at least 2 provided target words in that list.",
      "3) Keep task concrete and child-friendly.",
    ];
  }
  if (input.taskType === "speech_builder") {
    return [
      "Task quality rules for speech_builder:",
      "1) Use child wording: topic, main idea, one example, clear ending.",
      "2) Avoid method terms (hook, point, close).",
    ];
  }
  return [
    "Task quality rules:",
    "1) Make instruction concrete, age-appropriate, and immediately actionable.",
    "2) Avoid vague generic wording.",
  ];
}

function validatePromptQuality(spec: GeneratedTaskSpec, input: GenerateTaskSpecInput) {
  const prompt = (spec.prompt || "").trim();
  if (!prompt) return { ok: false, reason: "empty_prompt" };
  if (includesBannedPhrase(prompt)) return { ok: false, reason: "banned_generic_phrase" };
  if (countWords(prompt) < 6) return { ok: false, reason: "prompt_too_short" };

  if (input.taskType === "read_aloud") {
    const reference = extractReferenceText(prompt);
    if (!reference) return { ok: false, reason: "missing_reference_text" };
    const words = countWords(reference);
    if (words < 6 || words > 14) return { ok: false, reason: "bad_reference_length" };
    if (/short story|team playing a game/i.test(reference)) {
      return { ok: false, reason: "low_quality_reference_text" };
    }
  }

  if (input.taskType === "target_vocab" && input.targetWords.length >= 2) {
    const parsedWords = extractRequiredWords(prompt);
    const provided = new Set(input.targetWords.map((w) => w.toLowerCase().trim()));
    const overlap = parsedWords.filter((w) => provided.has(w)).length;
    if (overlap < 2) return { ok: false, reason: "target_words_not_respected" };
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
  const taskType = input.taskType;
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
  const targetNodes = coerceStringArray(row.target_nodes);

  return {
    taskType,
    prompt: instruction,
    constraints: {
      minSeconds: Math.max(5, Math.min(120, Math.round(minSeconds))),
      maxSeconds: Math.max(10, Math.min(180, Math.round(maxSeconds))),
    },
    maxDurationSec: Math.max(10, Math.min(120, Math.round(maxDurationSec))),
    assessmentMode: coerceMode(row.assessmentMode, taskType),
    expectedArtifacts: expectedArtifacts.length ? expectedArtifacts.slice(0, 12) : fallback.expectedArtifacts,
    scoringHooks: scoringHooks.length ? scoringHooks.slice(0, 12) : fallback.scoringHooks,
    estimatedDifficulty: Math.round(coerceDifficulty(row.estimated_difficulty, input.stage)),
    targetNodes: targetNodes.length ? targetNodes.slice(0, 8) : fallback.targetNodes,
    fallbackUsed: false,
  };
}

export async function generateTaskSpec(input: GenerateTaskSpecInput): Promise<GeneratedTaskSpec> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const fallback = fallbackTaskSpec(input);
  if (!apiKey) return fallback;

  const labels = input.targetNodeLabels?.filter(Boolean) ?? [];
  const hasLabels = labels.length > 0 && labels.length === input.targetNodeIds.length;
  const targetObjectivesBlock = hasLabels
    ? [
        "Target learning objectives (design the task so the learner can demonstrate these):",
        ...labels.map((desc, i) => `${i + 1}) ${desc}`),
        `In your JSON, set target_nodes to exactly these IDs in this order: ${input.targetNodeIds.join(", ")}`,
      ].join("\n")
    : `Target node IDs (copy into target_nodes): ${input.targetNodeIds.join(", ") || "none"}`;

  const prompt = [
    "Generate one speaking task for a child learner.",
    "Output JSON only with keys: task_type,instruction,constraints,maxDurationSec,assessmentMode,expected_artifacts,scoring_hooks,estimated_difficulty,target_nodes.",
    "Use simple child-friendly language and no method jargon.",
    "Keep instruction under 45 words.",
    `Stage: ${input.stage}`,
    `Age band: ${input.ageBand}`,
    `Task type required: ${input.taskType}`,
    `Primary goal: ${input.primaryGoal}`,
    `Target words: ${input.targetWords.join(", ") || "none"}`,
    targetObjectivesBlock,
    `Focus skills: ${input.focusSkills.join(", ") || "speaking"}`,
    `Planner reason: ${input.plannerReason}`,
    `Avoid repeating recent prompts: ${(input.recentPrompts || []).slice(0, 5).join(" || ") || "none"}`,
    input.taskType === "read_aloud"
      ? "For read_aloud: instruction MUST include exact text to read in quotes, e.g. Read this aloud clearly: '...'."
      : "For non-read_aloud: do not ask learner to read a reference sentence.",
    ...taskTypeQualityGuidance(input),
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
      return {
        ...fallback,
        fallbackReason: "openai_empty_content",
      };
    }
    const json = JSON.parse(content);
    const normalized = normalizeGeneratedPayload(json, input, fallback);
    if (!normalized) {
      return {
        ...fallback,
        fallbackReason: "openai_invalid_payload",
      };
    }
    if (normalized.taskType === "read_aloud" && !extractReferenceText(normalized.prompt)) {
      return {
        ...fallback,
        fallbackReason: "openai_missing_read_aloud_reference",
      };
    }
    if (isTooSimilarPrompt(normalized.prompt, input.recentPrompts || [])) {
      return {
        ...fallback,
        fallbackReason: "openai_repeated_prompt",
      };
    }
    const quality = validatePromptQuality(normalized, input);
    if (!quality.ok) {
      return {
        ...fallback,
        fallbackReason: `openai_low_quality_${quality.reason || "prompt"}`,
      };
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
      target_nodes: normalized.targetNodes,
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
      targetNodes: parsed.target_nodes,
      fallbackUsed: false,
      model,
    };
  } catch {
    return {
      ...fallback,
      fallbackReason: "openai_exception",
    };
  }
}
