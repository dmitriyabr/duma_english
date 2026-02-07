export type CEFRStage = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type AgeBand = "6-8" | "9-11" | "12-14";
export type SkillKey =
  | "pronunciation"
  | "fluency"
  | "tempo_control"
  | "vocabulary"
  | "task_completion";

export type BlueprintType =
  | "guided_practice"
  | "vocab_activation"
  | "dialogue_turn"
  | "speech_structure"
  | "review";

export type CbeTopic = {
  topicId: string;
  gradeBand: AgeBand;
  theme: string;
  keywords: string[];
  functions: Array<"describe" | "compare" | "present" | "persuade" | "narrate">;
};

export type CurriculumNode = {
  stage: CEFRStage;
  ageBand: AgeBand;
  week: number;
  focusSkills: SkillKey[];
  topicIds: string[];
  targetWords: string[];
  taskBlueprints: BlueprintType[];
  masteryChecks: string[];
};

export const CYCLE_WEEKS = 12;

const TOPIC_CATALOG: CbeTopic[] = [
  {
    topicId: "cbe_home_routines",
    gradeBand: "6-8",
    theme: "Home and routines",
    keywords: ["home", "family", "wake", "breakfast", "school"],
    functions: ["describe", "narrate"],
  },
  {
    topicId: "cbe_school_day",
    gradeBand: "6-8",
    theme: "School day",
    keywords: ["class", "teacher", "friends", "learn", "play"],
    functions: ["describe", "narrate"],
  },
  {
    topicId: "cbe_health_hygiene",
    gradeBand: "6-8",
    theme: "Health and hygiene",
    keywords: ["clean", "wash", "healthy", "food", "water"],
    functions: ["describe", "present"],
  },
  {
    topicId: "cbe_environment",
    gradeBand: "9-11",
    theme: "Environment and community",
    keywords: ["trees", "clean", "recycle", "river", "community"],
    functions: ["describe", "persuade"],
  },
  {
    topicId: "cbe_hobbies_sports",
    gradeBand: "9-11",
    theme: "Hobbies and sports",
    keywords: ["practice", "team", "game", "skills", "improve"],
    functions: ["describe", "compare"],
  },
  {
    topicId: "cbe_storytelling",
    gradeBand: "9-11",
    theme: "Storytelling and oral narratives",
    keywords: ["first", "then", "because", "finally", "lesson"],
    functions: ["narrate", "present"],
  },
  {
    topicId: "cbe_projects_innovation",
    gradeBand: "12-14",
    theme: "Projects and innovation",
    keywords: ["idea", "project", "problem", "solution", "impact"],
    functions: ["present", "persuade"],
  },
  {
    topicId: "cbe_civic_values",
    gradeBand: "12-14",
    theme: "Civic values and leadership",
    keywords: ["respect", "responsibility", "teamwork", "lead", "community"],
    functions: ["present", "persuade", "compare"],
  },
  {
    topicId: "cbe_future_plans",
    gradeBand: "12-14",
    theme: "Future plans and careers",
    keywords: ["goal", "future", "career", "study", "skills"],
    functions: ["describe", "present", "persuade"],
  },
];

const STAGE_SKILL_TARGETS: Record<CEFRStage, Record<SkillKey, string>> = {
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

const AGE_EXPECTED_LENGTH: Record<AgeBand, Record<CEFRStage, string>> = {
  "6-8": {
    A0: "1-2 short sentences",
    A1: "2-3 short sentences",
    A2: "3-4 sentences",
    B1: "4-5 sentences",
    B2: "5-6 sentences",
    C1: "6-7 sentences",
    C2: "7-8 sentences",
  },
  "9-11": {
    A0: "2 short sentences",
    A1: "3-4 sentences",
    A2: "4-6 sentences",
    B1: "6-8 sentences",
    B2: "8-10 sentences",
    C1: "10-12 sentences",
    C2: "12+ sentences",
  },
  "12-14": {
    A0: "2-3 short sentences",
    A1: "4-5 sentences",
    A2: "6-8 sentences",
    B1: "8-10 sentences",
    B2: "10-12 sentences",
    C1: "12-14 sentences",
    C2: "14+ sentences",
  },
};

function focusForWeek(week: number): SkillKey[] {
  if (week <= 4) return ["pronunciation", "vocabulary", "fluency"];
  if (week <= 8) return ["fluency", "task_completion", "tempo_control"];
  return ["task_completion", "tempo_control", "fluency"];
}

function blueprintsForWeek(week: number): BlueprintType[] {
  if (week <= 4) return ["guided_practice", "vocab_activation", "review"];
  if (week <= 8) return ["dialogue_turn", "guided_practice", "vocab_activation", "review"];
  return ["speech_structure", "dialogue_turn", "review"];
}

export function getTopicsForAgeBand(ageBand: AgeBand) {
  return TOPIC_CATALOG.filter((topic) => topic.gradeBand === ageBand);
}

export function getSkillMatrix(stage: CEFRStage, ageBand: AgeBand) {
  return {
    stage,
    ageBand,
    expectedResponseLength: AGE_EXPECTED_LENGTH[ageBand][stage],
    targets: STAGE_SKILL_TARGETS[stage],
  };
}

export function getCurriculumWeek(params: {
  stage: CEFRStage;
  ageBand: AgeBand;
  week: number;
}): CurriculumNode {
  const week = Math.max(1, Math.min(CYCLE_WEEKS, params.week));
  const topics = getTopicsForAgeBand(params.ageBand);
  const topicSlice = topics.slice((week - 1) % Math.max(topics.length, 1), ((week - 1) % Math.max(topics.length, 1)) + 2);
  const topicIds = (topicSlice.length ? topicSlice : topics).map((topic) => topic.topicId).slice(0, 2);
  const targetWords = (topicSlice.length ? topicSlice : topics)
    .flatMap((topic) => topic.keywords)
    .slice(0, 8);

  return {
    stage: params.stage,
    ageBand: params.ageBand,
    week,
    focusSkills: focusForWeek(week),
    topicIds,
    targetWords,
    taskBlueprints: blueprintsForWeek(week),
    masteryChecks: [
      "Student completes assigned speaking task type with relevance.",
      "Student uses target vocabulary in context.",
      "Student keeps age-appropriate response length and pace.",
    ],
  };
}

export function buildWeeklyCycle(stage: CEFRStage, ageBand: AgeBand) {
  return Array.from({ length: CYCLE_WEEKS }, (_, index) =>
    getCurriculumWeek({ stage, ageBand, week: index + 1 })
  );
}
