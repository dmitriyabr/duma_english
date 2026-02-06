import { z } from "zod";
import { SpeechMetrics } from "./scoring";

export type RubricCheck = {
  name: string;
  pass: boolean;
  reason: string;
  weight: number;
};

export type TaskEvaluation = {
  taskType: string;
  taskScore: number;
  languageScore?: number;
  artifacts: Record<string, unknown>;
  rubricChecks: RubricCheck[];
  evidence: string[];
  modelVersion: string;
};

export type FeedbackResult = {
  summary: string;
  whatWentWell: string[];
  whatToFixNow: string[];
  exampleBetterAnswer: string;
  nextMicroTask: string;
};

export type EvaluationDebugInfo = {
  openai: {
    enabled: boolean;
    model: string;
    attempts: Array<{
      try: number;
      status: number | null;
      ok: boolean;
      parseOk: boolean;
      parseError?: string;
      responsePreview?: string;
    }>;
    finalSource: "openai" | "rules";
    reason?: string;
  };
  promptPreview: string;
};

export type EvaluationInput = {
  taskType: string;
  taskPrompt: string;
  transcript: string;
  speechMetrics: SpeechMetrics;
  constraints?: { minSeconds?: number; maxSeconds?: number } | null;
  taskMeta?: Record<string, unknown> | null;
};

const MODEL_VERSION = "eval-v2";

const outputSchema = z.object({
  taskEvaluation: z.object({
    taskType: z.string(),
    taskScore: z.preprocess((value) => {
      if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "pass") return 78;
        if (v === "fail") return 35;
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      return value;
    }, z.number().min(0).max(100)),
    languageScore: z.preprocess((value) => {
      if (value === undefined || value === null || value === "") return undefined;
      if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      return value;
    }, z.number().min(0).max(100).optional()),
    artifacts: z.record(z.unknown()),
    rubricChecks: z.array(
      z.object({
        name: z.string(),
        pass: z.boolean(),
        reason: z.string(),
        weight: z.number().min(0).max(1),
      })
    ),
    evidence: z.array(z.string()).max(6),
    modelVersion: z.string(),
  }),
  feedback: z.object({
    summary: z.string(),
    whatWentWell: z.array(z.string()).min(1).max(3),
    whatToFixNow: z.array(z.string()).min(1).max(3),
    exampleBetterAnswer: z.string(),
    nextMicroTask: z.string(),
  }),
});

function normalizeWords(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function splitSentences(input: string) {
  return input
    .split(/[.!?]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function scoreFromChecks(checks: RubricCheck[]) {
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0) || 1;
  const passedWeight = checks.filter((c) => c.pass).reduce((sum, c) => sum + c.weight, 0);
  return clamp(Math.round((passedWeight / totalWeight) * 100));
}

export function computeLanguageScoreFromTaskEvaluation(taskEvaluation: TaskEvaluation) {
  if (typeof taskEvaluation.languageScore === "number") {
    return clamp(taskEvaluation.languageScore);
  }

  const wordsUsed = taskEvaluation.artifacts.requiredWordsUsed;
  const usageCorrectness = taskEvaluation.artifacts.wordUsageCorrectness;
  if (Array.isArray(wordsUsed) && typeof usageCorrectness === "number") {
    const lexicalRichness = clamp((wordsUsed.length / Math.max(wordsUsed.length + 1, 4)) * 100);
    return Math.round(clamp(usageCorrectness * 0.75 + lexicalRichness * 0.25));
  }

  const passRatio = scoreFromChecks(taskEvaluation.rubricChecks);
  return Math.round(clamp(passRatio * 0.9 + 10));
}

function buildFeedbackFromEvaluation(
  taskEvaluation: TaskEvaluation,
  fallbackExample: string,
  transcript: string
): FeedbackResult {
  const passed = taskEvaluation.rubricChecks.filter((c) => c.pass);
  const failed = taskEvaluation.rubricChecks.filter((c) => !c.pass);
  const weakest = failed.sort((a, b) => b.weight - a.weight)[0];
  const hasStrongAnswer = taskEvaluation.taskScore >= 85 && failed.length === 0;

  return {
    summary:
      taskEvaluation.taskScore >= 80
        ? "Strong task execution. Keep your clarity and structure."
        : "You are close. Focus on the key task requirements next.",
    whatWentWell: passed.slice(0, 3).map((c) => c.reason).filter(Boolean).length
      ? passed.slice(0, 3).map((c) => c.reason)
      : ["You completed the attempt and stayed on task."],
    whatToFixNow: failed.slice(0, 3).map((c) => c.reason).filter(Boolean).length
      ? failed.slice(0, 3).map((c) => c.reason)
      : ["Keep improving clarity and structure."],
    exampleBetterAnswer: hasStrongAnswer ? transcript : fallbackExample,
    nextMicroTask: weakest
      ? `Retry and focus on: ${weakest.name}.`
      : "Retry and keep the same structure with clearer delivery.",
  };
}

function evaluateReadAloud(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const referenceText = String(input.taskMeta?.referenceText || "");
  const refWords = normalizeWords(referenceText);
  const saidWords = normalizeWords(input.transcript);
  const saidSet = new Set(saidWords);
  const omittedWords = refWords.filter((w) => !saidSet.has(w));
  const insertedWords = saidWords.filter((w) => !refWords.includes(w));
  const coverage = refWords.length ? (refWords.length - omittedWords.length) / refWords.length : 0;
  const paValues = [
    input.speechMetrics.accuracy,
    input.speechMetrics.fluency,
    input.speechMetrics.completeness,
    input.speechMetrics.prosody,
  ].filter((value): value is number => typeof value === "number");
  const hasPa = paValues.length > 0;

  const checks: RubricCheck[] = [
    {
      name: "reference_coverage",
      pass: coverage >= 0.8,
      reason: coverage >= 0.8 ? "You covered most of the target sentence." : "You missed several target words.",
      weight: 0.45,
    },
    {
      name: "accuracy_score",
      pass: !hasPa || (input.speechMetrics.accuracy ?? 0) >= 70,
      reason:
        !hasPa
          ? "Pronunciation metrics are unavailable for this attempt."
          : (input.speechMetrics.accuracy ?? 0) >= 70
          ? "Pronunciation accuracy is at a good level."
          : "Work on word-level pronunciation accuracy.",
      weight: 0.35,
    },
    {
      name: "fluency_score",
      pass: !hasPa || (input.speechMetrics.fluency ?? 0) >= 65,
      reason:
        !hasPa
          ? "Fluency metrics are unavailable for this attempt."
          : (input.speechMetrics.fluency ?? 0) >= 65
          ? "Your reading flow is mostly smooth."
          : "Try to read in a smoother rhythm.",
      weight: 0.2,
    },
  ];

  const paAverage = hasPa ? paValues.reduce((sum, value) => sum + value, 0) / paValues.length : null;
  const fallbackTaskScore = scoreFromChecks(checks);
  const taskScore =
    paAverage === null
      ? fallbackTaskScore
      : Math.round(clamp(paAverage * 0.8 + coverage * 100 * 0.2));

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore,
    languageScore: Math.round(clamp((input.speechMetrics.completeness ?? taskScore) * 0.6 + coverage * 40)),
    artifacts: {
      referenceCoverage: Number((coverage * 100).toFixed(1)),
      omittedWords: omittedWords.slice(0, 8),
      insertedWords: insertedWords.slice(0, 8),
      mispronouncedHotspots: omittedWords.slice(0, 5),
    },
    rubricChecks: checks,
    evidence: [input.transcript.slice(0, 200)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    referenceText || "Read the target sentence again with clear pauses.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateTargetVocab(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const requiredWords =
    (Array.isArray(input.taskMeta?.requiredWords) ? input.taskMeta?.requiredWords : [])
      .map((w) => String(w).toLowerCase()) || [];
  const transcriptLower = input.transcript.toLowerCase();
  const requiredWordsUsed = requiredWords.filter((word) =>
    new RegExp(`\\b${word}\\w*\\b`, "i").test(transcriptLower)
  );
  const missingWords = requiredWords.filter((w) => !requiredWordsUsed.includes(w));
  const usageRatio = requiredWords.length ? requiredWordsUsed.length / requiredWords.length : 0;

  const checks: RubricCheck[] = [
    {
      name: "required_words_used",
      pass: usageRatio >= 0.75,
      reason:
        usageRatio >= 0.75
          ? "You used most target words."
          : "Use more of the required words in your answer.",
      weight: 0.6,
    },
    {
      name: "contextual_usage",
      pass: requiredWordsUsed.length >= 2 && splitSentences(input.transcript).length >= 2,
      reason:
        requiredWordsUsed.length >= 2 && splitSentences(input.transcript).length >= 2
          ? "The words are used in meaningful sentences."
          : "Use target words in full, meaningful sentences.",
      weight: 0.4,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(usageRatio * 100)),
    artifacts: {
      requiredWordsUsed,
      wordUsageCorrectness: Number((usageRatio * 100).toFixed(1)),
      inflectedFormsAccepted: requiredWordsUsed,
      missingWords,
    },
    rubricChecks: checks,
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "I feel happy when I learn new things. I can share ideas with my friend.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateRolePlay(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const text = input.transcript.toLowerCase();
  const questions = (input.transcript.match(/\?/g) || []).length;
  const greeting = /\b(hello|hi|good morning|good afternoon)\b/.test(text);
  const politeness = /\b(please|thank you|nice to meet you|welcome)\b/.test(text);
  const requiredActs = Array.isArray(input.taskMeta?.requiredActs)
    ? input.taskMeta.requiredActs.map((value) => String(value))
    : ["greeting", "two_questions"];
  const requiredActsCompleted = [
    greeting ? "greeting" : null,
    questions >= 2 ? "two_questions" : null,
    politeness ? "politeness" : null,
  ].filter((value): value is string => Boolean(value));
  const requiredActsDone = requiredActs.filter((value) => requiredActsCompleted.includes(value));

  const checks: RubricCheck[] = [
    {
      name: "greeting",
      pass: !requiredActs.includes("greeting") || greeting,
      reason: greeting ? "You opened with a greeting." : "Start with a clear greeting.",
      weight: 0.35,
    },
    {
      name: "questioning",
      pass: !requiredActs.includes("two_questions") || questions >= 2,
      reason: questions >= 2 ? "You asked enough questions." : "Ask at least two friendly questions.",
      weight: 0.4,
    },
    {
      name: "politeness",
      pass: politeness,
      reason: politeness ? "Your tone is polite and welcoming." : "Add polite phrases to sound welcoming.",
      weight: 0.25,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(55 + (requiredActsDone.length / Math.max(requiredActs.length, 1)) * 45)),
    artifacts: {
      requiredActsCompleted: requiredActsDone,
      turnSimulationQuality: scoreFromChecks(checks),
      politenessMarkers: Array.from(text.match(/\b(please|thank you|welcome|nice)\b/g) || []),
    },
    rubricChecks: checks,
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "Hi there. Welcome to our school. What do you enjoy learning? Do you have a favorite subject?",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateQAPrompt(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const sentences = splitSentences(input.transcript);
  const firstSentence = sentences[0] || "";
  const questionAnswered = normalizeWords(input.transcript).length >= 10;
  const directAnswerFirst = normalizeWords(firstSentence).length >= 4;
  const supportingReasons = (input.transcript.match(/\b(because|so|then|after)\b/gi) || []).length;
  const irrelevantSegments: string[] = [];

  const checks: RubricCheck[] = [
    {
      name: "question_answered",
      pass: questionAnswered,
      reason: questionAnswered ? "You gave a direct answer." : "Answer the question more directly.",
      weight: 0.45,
    },
    {
      name: "direct_answer_first",
      pass: directAnswerFirst,
      reason: directAnswerFirst ? "You started with a direct point." : "Start with your direct answer first.",
      weight: 0.25,
    },
    {
      name: "supporting_reasons",
      pass: supportingReasons >= 1,
      reason: supportingReasons >= 1 ? "You added supporting details." : "Add one reason or example.",
      weight: 0.3,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(50 + supportingReasons * 12 + (directAnswerFirst ? 12 : 0))),
    artifacts: {
      questionAnswered,
      directAnswerFirst,
      supportingReasons,
      irrelevantSegments,
    },
    rubricChecks: checks,
    evidence: [firstSentence, sentences[1] || ""].filter(Boolean),
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "After school, I usually finish homework, play football, and read for 20 minutes.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateTopicTalk(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const text = input.transcript.toLowerCase();
  const mainPointDetected = normalizeWords(input.transcript).length >= 12;
  const supportingDetailCount = (text.match(/\b(because|for example|for instance|when)\b/g) || []).length;
  const coherenceSignals = Array.from(text.match(/\b(first|then|because|so|finally)\b/g) || []);
  const offTopicRatio = 0;

  const checks: RubricCheck[] = [
    {
      name: "main_point_detected",
      pass: mainPointDetected,
      reason: mainPointDetected ? "You expressed a clear main point." : "State your main point clearly.",
      weight: 0.35,
    },
    {
      name: "supporting_detail_count",
      pass: supportingDetailCount >= 1,
      reason: supportingDetailCount >= 1 ? "You gave supporting details." : "Add at least one supporting detail.",
      weight: 0.35,
    },
    {
      name: "coherence",
      pass: coherenceSignals.length >= 1,
      reason: coherenceSignals.length >= 1 ? "Your talk had linking signals." : "Use linking words to organize ideas.",
      weight: 0.3,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(52 + supportingDetailCount * 10 + coherenceSignals.length * 6)),
    artifacts: {
      mainPointDetected,
      supportingDetailCount,
      offTopicRatio,
      coherenceSignals,
    },
    rubricChecks: checks,
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "My favorite place to play is the school field because I can run with my friends.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateFillerControl(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const words = normalizeWords(input.transcript);
  const fillers = words.filter((w) => ["um", "uh", "like"].includes(w));
  const fillerDensityPer100Words = words.length ? Number(((fillers.length / words.length) * 100).toFixed(2)) : 0;
  const topFillers = Array.from(new Set(fillers)).slice(0, 3);
  const selfCorrections = (input.transcript.match(/\b(i mean|sorry|let me)\b/gi) || []).length;

  const checks: RubricCheck[] = [
    {
      name: "filler_density",
      pass: fillerDensityPer100Words <= 4,
      reason:
        fillerDensityPer100Words <= 4
          ? "You kept filler words low."
          : "Reduce filler words to sound cleaner.",
      weight: 0.55,
    },
    {
      name: "steady_flow",
      pass: (input.speechMetrics.speechRate ?? 0) >= 90,
      reason:
        (input.speechMetrics.speechRate ?? 0) >= 90
          ? "Your speech flow is steady."
          : "Speak a little more steadily.",
      weight: 0.2,
    },
    {
      name: "self_corrections",
      pass: selfCorrections <= 2,
      reason:
        selfCorrections <= 2
          ? "You had few self-corrections."
          : "Try to reduce restarts and self-corrections.",
      weight: 0.25,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(70 - fillerDensityPer100Words * 3)),
    artifacts: {
      fillerDensityPer100Words,
      topFillers,
      selfCorrections,
    },
    rubricChecks: checks,
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "This morning I woke up, ate breakfast, and got ready for school.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateSpeechBuilder(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const sentences = splitSentences(input.transcript);
  const text = input.transcript.toLowerCase();
  const hookPresent = /\?|!|\b(imagine|did you know|today)\b/.test(sentences[0] || "");
  const pointPresent = /\b(i think|my point|important)\b/.test(text);
  const examplePresent = /\b(for example|for instance|when i|once)\b/.test(text);
  const closePresent = /\b(thank you|in conclusion|that is why|so)\b/.test(text);
  const orderQuality = sentences.length >= 4 ? 80 : 45;
  const requiredParts = Array.isArray(input.taskMeta?.requiredParts)
    ? input.taskMeta.requiredParts.map((value) => String(value))
    : ["hook", "point", "example", "close"];
  const parts = {
    hook: hookPresent,
    point: pointPresent,
    example: examplePresent,
    close: closePresent,
  };
  const presentCount = requiredParts.filter((part) => parts[part as keyof typeof parts]).length;

  const checks: RubricCheck[] = [
    {
      name: "parts_present",
      pass: presentCount >= Math.max(3, requiredParts.length - 1),
      reason:
        presentCount >= Math.max(3, requiredParts.length - 1)
          ? "You included most speech parts."
          : "Include all 4 parts: start, main idea, example, and ending.",
      weight: 0.7,
    },
    {
      name: "order_quality",
      pass: orderQuality >= 70,
      reason: orderQuality >= 70 ? "Your structure is mostly in order." : "Follow the expected order more clearly.",
      weight: 0.3,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(55 + presentCount * 10)),
    artifacts: {
      hookPresent,
      pointPresent,
      examplePresent,
      closePresent,
      orderQuality,
    },
    rubricChecks: checks,
    evidence: sentences.slice(0, 4),
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "Did you know reading every day can change your life? My point is simple: reading builds knowledge.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function selectExampleBetterAnswer(
  taskEvaluation: TaskEvaluation,
  transcript: string,
  candidate: string
) {
  const failedCount = taskEvaluation.rubricChecks.filter((check) => !check.pass).length;
  const hasStrongAnswer = taskEvaluation.taskScore >= 85 && failedCount === 0;
  if (hasStrongAnswer) return "";
  if (!candidate || candidate.trim().length < 20) return "";
  if (candidate.trim().toLowerCase() === transcript.trim().toLowerCase()) return "";
  return candidate;
}

function evaluateDeterministic(input: EvaluationInput) {
  switch (input.taskType) {
    case "read_aloud":
      return evaluateReadAloud(input);
    case "target_vocab":
      return evaluateTargetVocab(input);
    case "role_play":
      return evaluateRolePlay(input);
    case "qa_prompt":
      return evaluateQAPrompt(input);
    case "filler_control":
      return evaluateFillerControl(input);
    case "speech_builder":
      return evaluateSpeechBuilder(input);
    case "topic_talk":
    default:
      return evaluateTopicTalk(input);
  }
}

function buildTaskSpecificPrompt(taskType: string) {
  const rubricMap: Record<string, string> = {
    read_aloud:
      "Artifacts required: referenceCoverage, omittedWords, insertedWords, mispronouncedHotspots.",
    topic_talk:
      "Artifacts required: mainPointDetected, supportingDetailCount, offTopicRatio, coherenceSignals.",
    qa_prompt:
      "Artifacts required: questionAnswered, directAnswerFirst, supportingReasons, irrelevantSegments.",
    role_play:
      "Artifacts required: requiredActsCompleted, turnSimulationQuality, politenessMarkers.",
    target_vocab:
      "Artifacts required: requiredWordsUsed, wordUsageCorrectness, inflectedFormsAccepted, missingWords.",
    filler_control:
      "Artifacts required: fillerDensityPer100Words, topFillers, selfCorrections.",
    speech_builder:
      "Artifacts required: startPresent, mainIdeaPresent, examplePresent, endingPresent, orderQuality.",
  };
  return rubricMap[taskType] || rubricMap.topic_talk;
}

async function evaluateWithOpenAI(input: EvaluationInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    return {
      parsed: null,
      debug: {
        openai: {
          enabled: false,
          model,
          attempts: [],
          finalSource: "rules" as const,
          reason: "OPENAI_API_KEY is missing",
        },
      },
    };
  }

  const prompt = [
    "Evaluate this speaking attempt with strict task-specific rubric.",
    "Do not invent speech numeric metrics; use only speech fields provided in input.",
    "Return JSON only matching this contract:",
    "{ taskEvaluation: { taskType, taskScore, artifacts, rubricChecks[{name,pass,reason,weight}], evidence, modelVersion }, feedback: { summary, whatWentWell, whatToFixNow, exampleBetterAnswer, nextMicroTask } }",
    buildTaskSpecificPrompt(input.taskType),
    JSON.stringify(input),
  ].join("\n");
  const attempts: EvaluationDebugInfo["openai"]["attempts"] = [];

  for (let i = 0; i < 2; i += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a strict speaking evaluator for children. Output JSON only, no markdown.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      attempts.push({
        try: i + 1,
        status: response.status,
        ok: false,
        parseOk: false,
      });
      continue;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      attempts.push({
        try: i + 1,
        status: response.status,
        ok: true,
        parseOk: false,
      });
      continue;
    }
    try {
      const parsed = outputSchema.parse(JSON.parse(content));
      attempts.push({
        try: i + 1,
        status: response.status,
        ok: true,
        parseOk: true,
        responsePreview: content.slice(0, 500),
      });
      return {
        parsed,
        debug: {
          openai: {
            enabled: true,
            model,
            attempts,
            finalSource: "openai" as const,
          },
        },
      };
    } catch (error) {
      attempts.push({
        try: i + 1,
        status: response.status,
        ok: true,
        parseOk: false,
        parseError: error instanceof Error ? error.message.slice(0, 200) : "JSON parse failed",
        responsePreview: content.slice(0, 500),
      });
      console.log(JSON.stringify({ event: "openai_schema_fail", try: i + 1 }));
    }
  }
  return {
    parsed: null,
    debug: {
      openai: {
        enabled: true,
        model,
        attempts,
        finalSource: "rules" as const,
        reason: "invalid or non-schema JSON from model",
      },
    },
  };
}

export async function evaluateTaskQuality(input: EvaluationInput) {
  const promptPreview = `${input.taskType} :: ${input.taskPrompt.slice(0, 160)}`;
  const fromModel = await evaluateWithOpenAI(input);
  if (fromModel.parsed) {
    const modelTaskEvaluation = {
      ...fromModel.parsed.taskEvaluation,
      modelVersion: `${MODEL_VERSION}+openai`,
    };
    const normalizedFeedback = {
      ...fromModel.parsed.feedback,
      exampleBetterAnswer: selectExampleBetterAnswer(
        modelTaskEvaluation,
        input.transcript,
        fromModel.parsed.feedback.exampleBetterAnswer
      ),
    };
    return {
      taskEvaluation: modelTaskEvaluation,
      feedback: normalizedFeedback,
      source: "openai" as const,
      debug: {
        ...fromModel.debug,
        promptPreview,
      },
    };
  }

  const fallback = evaluateDeterministic(input);
  console.log(JSON.stringify({ event: "fallback_used", taskType: input.taskType, reason: fromModel.debug.openai.reason }));
  return {
    ...fallback,
    source: "rules" as const,
    debug: {
      ...fromModel.debug,
      promptPreview,
    },
  };
}
