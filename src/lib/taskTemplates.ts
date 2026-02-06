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
      "Speak 4 short sentences: 1) what your topic is, 2) your main idea, 3) one example, 4) a clear ending.",
    constraints: { minSeconds: 25, maxSeconds: 90 },
    maxDurationSec: 60,
    meta: {
      supportsPronAssessment: false,
      rubricType: "speech_builder",
      requiredParts: ["hook", "point", "example", "close"],
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
      "Speak 4 short sentences: 1) topic, 2) your idea, 3) one example, 4) clear ending.";
  }

  return next;
}
