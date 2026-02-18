const DISCOURSE_TASK_TYPES = ["topic_talk", "qa_prompt", "role_play", "speech_builder"] as const;

export const DISCOURSE_PRAGMATICS_VERSION = "discourse-pragmatics-v1" as const;
export const DISCOURSE_PRAGMATICS_PASS_THRESHOLD = 65;
export const DISCOURSE_PRAGMATICS_DIMENSIONS = [
  "argumentStructure",
  "registerControl",
  "turnTakingRepair",
  "cohesion",
  "audienceFit",
] as const;

export type DiscourseDimensionKey = (typeof DISCOURSE_PRAGMATICS_DIMENSIONS)[number];
export type ExpectedRegister = "formal" | "conversational" | "neutral";

export type DiscourseRubricCheck = {
  name: string;
  pass: boolean;
  reason: string;
  weight: number;
};

export type DiscoursePragmaticsAssessment = {
  version: typeof DISCOURSE_PRAGMATICS_VERSION;
  taskType: string;
  expectedRegister: ExpectedRegister;
  scores: Record<DiscourseDimensionKey, number>;
  passByDimension: Record<DiscourseDimensionKey, boolean>;
  overallScore: number;
  rubricChecks: DiscourseRubricCheck[];
  signals: {
    sentenceCount: number;
    wordCount: number;
    connectorCount: number;
    repairCueCount: number;
    audienceCueCount: number;
    formalCueCount: number;
    conversationalCueCount: number;
  };
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countPattern(input: string, pattern: RegExp) {
  return (input.match(pattern) || []).length;
}

function normalizeText(input: string) {
  return input.toLowerCase();
}

function words(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function sentenceCount(input: string) {
  const parts = input
    .split(/[.!?]+/)
    .map((row) => row.trim())
    .filter(Boolean);
  return parts.length;
}

function detectExpectedRegister(prompt: string): ExpectedRegister {
  const text = normalizeText(prompt);
  if (
    text.includes("formal") ||
    text.includes("presentation") ||
    text.includes("debate") ||
    text.includes("teacher") ||
    text.includes("principal")
  ) {
    return "formal";
  }
  if (
    text.includes("chat") ||
    text.includes("friend") ||
    text.includes("conversation") ||
    text.includes("role-play")
  ) {
    return "conversational";
  }
  return "neutral";
}

function buildDimensionScores(params: {
  taskType: string;
  transcript: string;
  taskPrompt: string;
}) {
  const transcript = normalizeText(params.transcript || "");
  const tokenList = words(params.transcript || "");
  const wordCount = tokenList.length;
  const sentences = sentenceCount(params.transcript || "");

  const claimCueCount = countPattern(
    transcript,
    /\b(i think|i believe|my point|in my view|we should|this shows|i argue)\b/g,
  );
  const reasonCueCount = countPattern(
    transcript,
    /\b(because|since|therefore|so|as a result)\b/g,
  );
  const exampleCueCount = countPattern(
    transcript,
    /\b(for example|for instance|when|once|such as)\b/g,
  );
  const conclusionCueCount = countPattern(
    transcript,
    /\b(in conclusion|to sum up|overall|finally|that is why)\b/g,
  );

  const formalCueCount = countPattern(
    transcript,
    /\b(therefore|however|moreover|furthermore|respectfully|sincerely)\b/g,
  );
  const conversationalCueCount = countPattern(
    transcript,
    /\b(hey|hi|guys|wanna|gonna|kinda|man|dude|bro)\b/g,
  );

  const repairCueCount = countPattern(
    transcript,
    /\b(sorry|i mean|let me rephrase|to clarify|in other words|do you mean|can you repeat)\b/g,
  );
  const responseCueCount = countPattern(
    transcript,
    /\b(what do you think|can you tell me|your turn|please answer|could you)\b/g,
  );

  const connectorCount = countPattern(
    transcript,
    /\b(first|second|then|next|also|because|so|however|therefore|finally|meanwhile)\b/g,
  );
  const audienceCueCount = countPattern(
    transcript,
    /\b(you|your|we|our|class|teacher|friend|audience|team|everyone)\b/g,
  );
  const politenessCueCount = countPattern(
    transcript,
    /\b(please|thank you|thanks|excuse me|welcome)\b/g,
  );

  const expectedRegister = detectExpectedRegister(params.taskPrompt || "");

  const argumentStructure = clamp(
    18 +
      Math.min(25, claimCueCount * 15) +
      Math.min(20, reasonCueCount * 10) +
      Math.min(20, exampleCueCount * 10) +
      Math.min(15, conclusionCueCount * 15) +
      Math.min(22, sentences * 4),
  );

  const registerBias =
    expectedRegister === "formal"
      ? formalCueCount * 8 - conversationalCueCount * 10
      : expectedRegister === "conversational"
      ? conversationalCueCount * 7 - formalCueCount * 5
      : formalCueCount * 3 + conversationalCueCount * 2 - Math.abs(formalCueCount - conversationalCueCount) * 2;
  const registerControl = clamp(68 + registerBias);

  const taskTypeBoost = params.taskType === "role_play" ? 10 : params.taskType === "qa_prompt" ? 5 : 0;
  const turnTakingRepair = clamp(
    24 + taskTypeBoost + Math.min(30, repairCueCount * 14) + Math.min(28, responseCueCount * 12),
  );

  const cohesion = clamp(
    28 +
      Math.min(40, connectorCount * 8) +
      Math.min(20, sentences * 4) +
      (wordCount >= 30 ? 8 : wordCount >= 15 ? 4 : 0),
  );

  const audienceFit = clamp(
    32 +
      Math.min(30, audienceCueCount * 5) +
      Math.min(20, politenessCueCount * 8) +
      (expectedRegister === "formal" && conversationalCueCount > 0 ? -12 : 0),
  );

  return {
    expectedRegister,
    scores: {
      argumentStructure: round(argumentStructure),
      registerControl: round(registerControl),
      turnTakingRepair: round(turnTakingRepair),
      cohesion: round(cohesion),
      audienceFit: round(audienceFit),
    },
    signals: {
      sentenceCount: sentences,
      wordCount,
      connectorCount,
      repairCueCount: repairCueCount + responseCueCount,
      audienceCueCount,
      formalCueCount,
      conversationalCueCount,
    },
  };
}

function reasonForDimension(
  dimension: DiscourseDimensionKey,
  score: number,
): string {
  if (score >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD) {
    if (dimension === "argumentStructure") return "Argument has a clear claim-support flow.";
    if (dimension === "registerControl") return "Register mostly matches the expected audience and context.";
    if (dimension === "turnTakingRepair") return "Turn-taking and repair cues are present and helpful.";
    if (dimension === "cohesion") return "Ideas are connected with clear discourse markers.";
    return "Response shows audience-aware tone and framing.";
  }

  if (dimension === "argumentStructure") return "Add a clearer claim, reason, and example sequence.";
  if (dimension === "registerControl") return "Adjust tone/register to better match the task context.";
  if (dimension === "turnTakingRepair") return "Use more turn-taking or repair cues to sustain interaction.";
  if (dimension === "cohesion") return "Link ideas with clearer connectors and transitions.";
  return "Adapt wording for the intended audience more explicitly.";
}

export function isDiscoursePragmaticsTaskType(taskType: string) {
  return DISCOURSE_TASK_TYPES.includes(taskType as (typeof DISCOURSE_TASK_TYPES)[number]);
}

export function evaluateDiscoursePragmatics(params: {
  taskType: string;
  transcript: string;
  taskPrompt: string;
}): DiscoursePragmaticsAssessment {
  const payload = buildDimensionScores(params);
  const passByDimension = DISCOURSE_PRAGMATICS_DIMENSIONS.reduce(
    (acc, dimension) => {
      acc[dimension] = payload.scores[dimension] >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD;
      return acc;
    },
    {} as Record<DiscourseDimensionKey, boolean>,
  );
  const overallScore = round(
    (payload.scores.argumentStructure * 0.24 +
      payload.scores.registerControl * 0.18 +
      payload.scores.turnTakingRepair * 0.2 +
      payload.scores.cohesion * 0.2 +
      payload.scores.audienceFit * 0.18),
  );

  const rubricChecks: DiscourseRubricCheck[] = [
    {
      name: "argument_structure",
      pass: passByDimension.argumentStructure,
      reason: reasonForDimension("argumentStructure", payload.scores.argumentStructure),
      weight: 0.24,
    },
    {
      name: "register_control",
      pass: passByDimension.registerControl,
      reason: reasonForDimension("registerControl", payload.scores.registerControl),
      weight: 0.18,
    },
    {
      name: "turn_taking_repair",
      pass: passByDimension.turnTakingRepair,
      reason: reasonForDimension("turnTakingRepair", payload.scores.turnTakingRepair),
      weight: 0.2,
    },
    {
      name: "cohesion",
      pass: passByDimension.cohesion,
      reason: reasonForDimension("cohesion", payload.scores.cohesion),
      weight: 0.2,
    },
    {
      name: "audience_fit",
      pass: passByDimension.audienceFit,
      reason: reasonForDimension("audienceFit", payload.scores.audienceFit),
      weight: 0.18,
    },
  ];

  return {
    version: DISCOURSE_PRAGMATICS_VERSION,
    taskType: params.taskType,
    expectedRegister: payload.expectedRegister,
    scores: payload.scores,
    passByDimension,
    overallScore,
    rubricChecks,
    signals: payload.signals,
  };
}

export function adjudicateDiscoursePragmatics(params: {
  taskType: string;
  transcript: string;
  taskPrompt: string;
}) {
  const assessment = evaluateDiscoursePragmatics(params);
  const strictScores = {
    argumentStructure: clamp(assessment.scores.argumentStructure - 4),
    registerControl: clamp(assessment.scores.registerControl - 3),
    turnTakingRepair: clamp(assessment.scores.turnTakingRepair - 6),
    cohesion: clamp(assessment.scores.cohesion - 4),
    audienceFit: clamp(assessment.scores.audienceFit - 3),
  };
  const passByDimension = {
    argumentStructure: strictScores.argumentStructure >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD,
    registerControl: strictScores.registerControl >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD,
    turnTakingRepair: strictScores.turnTakingRepair >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD,
    cohesion: strictScores.cohesion >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD,
    audienceFit: strictScores.audienceFit >= DISCOURSE_PRAGMATICS_PASS_THRESHOLD,
  };
  return {
    ...assessment,
    scores: strictScores,
    passByDimension,
    overallScore: round(
      strictScores.argumentStructure * 0.24 +
        strictScores.registerControl * 0.18 +
        strictScores.turnTakingRepair * 0.2 +
        strictScores.cohesion * 0.2 +
        strictScores.audienceFit * 0.18,
    ),
  };
}
