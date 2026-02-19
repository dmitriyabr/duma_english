export type TaskTemplate = {
  type: string;
  level: number;
  prompt: string;
  assessmentMode: "pa" | "stt";
  constraints: {
    minSeconds: number;
    maxSeconds: number;
  };
  maxDurationSec: number;
  meta?: Record<string, unknown>;
};

export type TaskTemplateBuildOptions = {
  targetWords?: string[];
  stage?: string;
  reason?: string;
  focusSkills?: string[];
};

const baseConstraints = { minSeconds: 20, maxSeconds: 90 };

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    type: "read_aloud",
    level: 1,
    prompt: "Read this aloud clearly: 'I like going to school because I learn new things.'",
    assessmentMode: "pa",
    constraints: { minSeconds: 10, maxSeconds: 40 },
    maxDurationSec: 30,
    meta: {
      supportsPronAssessment: true,
      referenceText: "I like going to school because I learn new things.",
      rubricType: "read_aloud",
    },
  },
  {
    type: "reading_comprehension",
    level: 1,
    prompt:
      "Read the passage and answer in 3-4 sentences.\nPassage: Amina reads library books every evening because stories help her learn new words.\nQuestion: Why does Amina read library books every evening?",
    assessmentMode: "stt",
    constraints: { minSeconds: 25, maxSeconds: 90 },
    maxDurationSec: 75,
    meta: {
      supportsPronAssessment: false,
      rubricType: "reading_comprehension",
      modality: "reading",
      readingPromptVersion: "reading-runtime-v1",
    },
  },
  {
    type: "writing_prompt",
    level: 1,
    prompt:
      "Write 5-7 sentences about a school challenge you solved. Include what happened, what you did, and what changed.",
    assessmentMode: "stt",
    constraints: { minSeconds: 60, maxSeconds: 300 },
    maxDurationSec: 240,
    meta: {
      supportsPronAssessment: false,
      rubricType: "writing_prompt",
      modality: "writing",
      assessmentModeOverride: "text",
      minWordCount: 45,
      requiresRevisionHint: true,
    },
  },
  {
    type: "topic_talk",
    level: 1,
    prompt: "Talk about your favorite place to play. Say where it is and why you like it.",
    assessmentMode: "stt",
    constraints: baseConstraints,
    maxDurationSec: 60,
    meta: { supportsPronAssessment: false, rubricType: "topic_talk" },
  },
  {
    type: "qa_prompt",
    level: 1,
    prompt: "Question: What do you do after school? Answer in 3-4 sentences.",
    assessmentMode: "stt",
    constraints: baseConstraints,
    maxDurationSec: 60,
    meta: { supportsPronAssessment: false, rubricType: "qa_prompt" },
  },
  {
    type: "role_play",
    level: 1,
    prompt: "Role-play: You are greeting a new student. Say hello and ask two friendly questions.",
    assessmentMode: "stt",
    constraints: baseConstraints,
    maxDurationSec: 60,
    meta: {
      supportsPronAssessment: false,
      rubricType: "role_play",
      requiredActs: ["greeting", "two_questions"],
    },
  },
  {
    type: "target_vocab",
    level: 1,
    prompt: "Use these words in a short talk: happy, learn, share, friend.",
    assessmentMode: "stt",
    constraints: baseConstraints,
    maxDurationSec: 60,
    meta: {
      supportsPronAssessment: false,
      rubricType: "target_vocab",
      requiredWords: ["happy", "learn", "share", "friend"],
    },
  },
  {
    type: "filler_control",
    level: 1,
    prompt: "Speak about your morning. Try to avoid filler words like 'um' and 'uh'.",
    assessmentMode: "stt",
    constraints: baseConstraints,
    maxDurationSec: 60,
    meta: { supportsPronAssessment: false, rubricType: "filler_control" },
  },
  {
    type: "speech_builder",
    level: 1,
    assessmentMode: "stt",
    prompt:
      "Speak in 4 short steps: 1) say your topic, 2) say your main idea, 3) give one example, 4) finish clearly.",
    constraints: { minSeconds: 25, maxSeconds: 90 },
    maxDurationSec: 60,
    meta: {
      supportsPronAssessment: false,
      rubricType: "speech_builder",
      requiredParts: ["hook", "point", "example", "close"],
    },
  },
  {
    type: "argumentation",
    level: 1,
    prompt:
      "Argumentation task: take a position on 'School uniforms should be required' and include a claim, two reasons, one counterargument, and a conclusion.",
    assessmentMode: "stt",
    constraints: { minSeconds: 35, maxSeconds: 120 },
    maxDurationSec: 60,
    meta: {
      supportsPronAssessment: false,
      rubricType: "argumentation",
      discourseFamily: "argumentation",
      requiredParts: ["claim", "reasons", "counterargument", "conclusion"],
      recommendedStages: ["C1", "C2"],
    },
  },
  {
    type: "register_switch",
    level: 1,
    prompt:
      "Register switch task: explain the same school problem twice - first to your principal (formal), then to your best friend (conversational).",
    assessmentMode: "stt",
    constraints: { minSeconds: 35, maxSeconds: 120 },
    maxDurationSec: 60,
    meta: {
      supportsPronAssessment: false,
      rubricType: "register_switch",
      discourseFamily: "register_switch",
      expectedRegisters: ["formal", "conversational"],
      recommendedStages: ["C1", "C2"],
    },
  },
  {
    type: "misunderstanding_repair",
    level: 1,
    prompt:
      "Misunderstanding repair: your partner misunderstands your plan. Clarify, rephrase, check understanding, and agree on the next step.",
    assessmentMode: "stt",
    constraints: { minSeconds: 35, maxSeconds: 120 },
    maxDurationSec: 60,
    meta: {
      supportsPronAssessment: false,
      rubricType: "misunderstanding_repair",
      discourseFamily: "misunderstanding_repair",
      requiredActs: ["clarify", "rephrase", "check_understanding", "confirm_next_step"],
      recommendedStages: ["C1", "C2"],
    },
  },
];

export function pickTaskTemplate() {
  const index = Math.floor(Math.random() * TASK_TEMPLATES.length);
  return TASK_TEMPLATES[index];
}

export function pickTaskTemplateByType(type: string) {
  return TASK_TEMPLATES.find((template) => template.type === type) || null;
}

export function buildTaskTemplate(type: string, options: TaskTemplateBuildOptions = {}) {
  const base = pickTaskTemplateByType(type) || pickTaskTemplate();
  const targetWords = (options.targetWords || []).slice(0, 6);
  const next: TaskTemplate = {
    ...base,
    meta: {
      ...(base.meta || {}),
      stage: options.stage || "A0",
      plannerReason: options.reason || null,
      focusSkills: options.focusSkills || [],
    },
  };

  if (base.type === "target_vocab" && targetWords.length > 0) {
    next.prompt = `Use these words in your short talk: ${targetWords.join(", ")}.`;
    next.meta = {
      ...(next.meta || {}),
      requiredWords: targetWords,
    };
  }

  if (base.type === "speech_builder") {
    next.prompt =
      "Speak in 4 short steps: 1) topic, 2) your idea, 3) one example, 4) clear ending.";
  }

  if (base.type === "argumentation") {
    next.prompt =
      "Take a clear position, give two reasons, include one counterargument, and finish with a conclusion.";
  }

  if (base.type === "register_switch") {
    next.prompt =
      "Say your message twice: first in formal style for a teacher, then in conversational style for a friend.";
  }

  if (base.type === "misunderstanding_repair") {
    next.prompt =
      "Repair a misunderstanding: clarify your idea, rephrase it, check understanding, and confirm the next step.";
  }

  if (base.type === "writing_prompt") {
    next.prompt =
      "Write 5-7 sentences about a real school experience. Explain the situation, your action, and the result.";
  }

  return next;
}
