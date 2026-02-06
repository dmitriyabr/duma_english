import { prisma } from "./db";
import { CEFRStage, SkillKey } from "./curriculum";

export type PlacementQuestion = {
  id: string;
  skillKey: SkillKey;
  taskType: string;
  prompt: string;
  hint: string;
  expectedMinWords: number;
  assessmentMode: "pa" | "stt";
  maxDurationSec: number;
  meta?: Record<string, unknown>;
};

export type PlacementAnswerInput = {
  questionId: string;
  attemptId?: string;
  transcript?: string;
  selfRating?: number;
  observedMetrics?: {
    speechScore?: number | null;
    taskScore?: number | null;
    languageScore?: number | null;
    overallScore?: number | null;
    reliability?: string | null;
    speechRate?: number | null;
    pronunciation?: number | null;
    fluency?: number | null;
    vocabularyUsage?: number | null;
    taskCompletion?: number | null;
  };
};

const QUESTIONS: PlacementQuestion[] = [
  {
    id: "intro",
    skillKey: "fluency",
    taskType: "topic_talk",
    prompt: "Tell us about yourself in 3-4 short sentences.",
    hint: "Name, age, school or hobby.",
    expectedMinWords: 18,
    assessmentMode: "stt",
    maxDurationSec: 60,
  },
  {
    id: "vocab",
    skillKey: "vocabulary",
    taskType: "target_vocab",
    prompt: "Use these words: learn, friend, school.",
    hint: "Try to use all words in full sentences.",
    expectedMinWords: 16,
    assessmentMode: "stt",
    maxDurationSec: 60,
    meta: {
      requiredWords: ["learn", "friend", "school"],
    },
  },
  {
    id: "tempo",
    skillKey: "tempo_control",
    taskType: "filler_control",
    prompt: "Talk about your morning routine clearly.",
    hint: "Speak steadily, not too fast.",
    expectedMinWords: 20,
    assessmentMode: "stt",
    maxDurationSec: 60,
  },
  {
    id: "task",
    skillKey: "task_completion",
    taskType: "qa_prompt",
    prompt: "Answer: Why is teamwork important in class?",
    hint: "Give one reason and one example.",
    expectedMinWords: 20,
    assessmentMode: "stt",
    maxDurationSec: 60,
  },
  {
    id: "pron",
    skillKey: "pronunciation",
    taskType: "read_aloud",
    prompt: "Read aloud: I like learning new things with my friends.",
    hint: "Read clearly and calmly.",
    expectedMinWords: 10,
    assessmentMode: "pa",
    maxDurationSec: 30,
    meta: {
      supportsPronAssessment: true,
      referenceText: "I like learning new things with my friends.",
    },
  },
];

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWords(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function scorePlacementAnswer(question: PlacementQuestion, answer: PlacementAnswerInput) {
  const observed = answer.observedMetrics;
  if (observed) {
    const speech = typeof observed.speechScore === "number" ? observed.speechScore : null;
    const task = typeof observed.taskScore === "number" ? observed.taskScore : null;
    const language = typeof observed.languageScore === "number" ? observed.languageScore : null;
    const pronunciation =
      typeof observed.pronunciation === "number"
        ? observed.pronunciation
        : typeof observed.speechScore === "number" && question.skillKey === "pronunciation"
        ? observed.speechScore
        : null;
    const fluency =
      typeof observed.fluency === "number"
        ? observed.fluency
        : typeof observed.speechScore === "number" && question.skillKey === "fluency"
        ? observed.speechScore
        : null;
    const tempo =
      typeof observed.speechRate === "number"
        ? observed.speechRate >= 100 && observed.speechRate <= 150
          ? 85
          : observed.speechRate >= 90 && observed.speechRate <= 165
          ? 72
          : 58
        : null;
    const vocab =
      typeof observed.vocabularyUsage === "number"
        ? observed.vocabularyUsage
        : typeof language === "number"
        ? language
        : null;
    const completion =
      typeof observed.taskCompletion === "number"
        ? observed.taskCompletion
        : typeof task === "number"
        ? task
        : null;

    if (question.skillKey === "pronunciation" && pronunciation !== null) {
      return Math.round(clamp(pronunciation));
    }
    if (question.skillKey === "fluency" && fluency !== null) {
      return Math.round(clamp(fluency));
    }
    if (question.skillKey === "tempo_control" && tempo !== null) {
      return Math.round(clamp(tempo));
    }
    if (question.skillKey === "vocabulary" && vocab !== null) {
      return Math.round(clamp(vocab));
    }
    if (question.skillKey === "task_completion" && completion !== null) {
      return Math.round(clamp(completion));
    }

    const weighted = [speech, task, language].filter((v): v is number => typeof v === "number");
    if (weighted.length > 0) {
      const avg = weighted.reduce((sum, value) => sum + value, 0) / weighted.length;
      return Math.round(clamp(avg));
    }
  }

  const transcript = (answer.transcript || "").trim();
  const words = normalizeWords(transcript);
  const minWordRatio = question.expectedMinWords > 0 ? words.length / question.expectedMinWords : 1;
  const lengthScore = clamp(minWordRatio * 60);
  const self = typeof answer.selfRating === "number" ? clamp(answer.selfRating, 1, 5) : 3;
  const selfScore = ((self - 1) / 4) * 40;
  return Math.round(clamp(lengthScore + selfScore));
}

function stageFromScore(score: number): CEFRStage {
  if (score >= 80) return "B1";
  if (score >= 65) return "A2";
  if (score >= 50) return "A1";
  return "A0";
}

export function getPlacementQuestions() {
  return QUESTIONS;
}

export function getPlacementQuestionByIndex(index: number) {
  if (index < 0 || index >= QUESTIONS.length) return null;
  return QUESTIONS[index];
}

export function computePlacementResult(responses: Record<string, PlacementAnswerInput>) {
  const skillScores: Record<SkillKey, number> = {
    pronunciation: 0,
    fluency: 0,
    tempo_control: 0,
    vocabulary: 0,
    task_completion: 0,
  };
  const counts: Record<SkillKey, number> = {
    pronunciation: 0,
    fluency: 0,
    tempo_control: 0,
    vocabulary: 0,
    task_completion: 0,
  };

  for (const question of QUESTIONS) {
    const answer = responses[question.id];
    if (!answer) continue;
    const score = scorePlacementAnswer(question, answer);
    skillScores[question.skillKey] += score;
    counts[question.skillKey] += 1;
  }

  const skillSnapshot = Object.fromEntries(
    (Object.keys(skillScores) as SkillKey[]).map((key) => [
      key,
      counts[key] > 0 ? Number((skillScores[key] / counts[key]).toFixed(2)) : 40,
    ])
  ) as Record<SkillKey, number>;

  const average = Number(
    (
      Object.values(skillSnapshot).reduce((sum, value) => sum + value, 0) /
      Object.values(skillSnapshot).length
    ).toFixed(2)
  );
  const stage = stageFromScore(average);
  const responseValues = Object.values(responses);
  const answered = responseValues.length;
  const observedCoverage =
    responseValues.length > 0
      ? responseValues.filter((response) => Boolean(response.observedMetrics)).length / responseValues.length
      : 0;
  const confidence = Number(
    Math.min(0.95, 0.45 + answered * 0.06 + observedCoverage * 0.2).toFixed(2)
  );

  return { stage, average, confidence, skillSnapshot };
}

export async function startPlacement(studentId: string) {
  const existing = await prisma.placementSession.findFirst({
    where: { studentId, status: "started" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return prisma.placementSession.create({
    data: {
      studentId,
      status: "started",
      currentIndex: 0,
      responsesJson: {},
    },
  });
}

export async function submitPlacementAnswer(sessionId: string, answer: PlacementAnswerInput) {
  const session = await prisma.placementSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Placement session not found");
  if (session.status !== "started") throw new Error("Placement session is not active");

  const responses = ((session.responsesJson || {}) as Record<string, PlacementAnswerInput>);
  responses[answer.questionId] = answer;
  const nextIndex = Math.min(QUESTIONS.length, session.currentIndex + 1);

  const updated = await prisma.placementSession.update({
    where: { id: session.id },
    data: {
      currentIndex: nextIndex,
      responsesJson: responses,
    },
  });

  return updated;
}

export async function finishPlacement(sessionId: string) {
  const session = await prisma.placementSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Placement session not found");

  const responses = ((session.responsesJson || {}) as Record<string, PlacementAnswerInput>);
  const result = computePlacementResult(responses);

  await prisma.placementSession.update({
    where: { id: session.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      resultJson: {
        stage: result.stage,
        average: result.average,
        confidence: result.confidence,
        skillSnapshot: result.skillSnapshot,
      },
    },
  });

  await prisma.learnerProfile.upsert({
    where: { studentId: session.studentId },
    update: {
      stage: result.stage,
      placementScore: result.average,
      placementConfidence: result.confidence,
      cycleWeek: 1,
    },
    create: {
      studentId: session.studentId,
      stage: result.stage,
      placementScore: result.average,
      placementConfidence: result.confidence,
      cycleWeek: 1,
    },
  });

  for (const [skillKey, masteryScore] of Object.entries(result.skillSnapshot) as Array<[SkillKey, number]>) {
    await prisma.studentSkillMastery.upsert({
      where: {
        studentId_skillKey: {
          studentId: session.studentId,
          skillKey,
        },
      },
      update: {
        masteryScore,
        reliability: "medium",
        evidenceCount: { increment: 1 },
        lastAssessedAt: new Date(),
      },
      create: {
        studentId: session.studentId,
        skillKey,
        masteryScore,
        reliability: "medium",
        evidenceCount: 1,
        lastAssessedAt: new Date(),
      },
    });
  }

  const day = new Date();
  day.setHours(0, 0, 0, 0);
  for (const [skillKey, value] of Object.entries(result.skillSnapshot) as Array<[SkillKey, number]>) {
    await prisma.studentSkillDaily.upsert({
      where: {
        studentId_date_skillKey: {
          studentId: session.studentId,
          date: day,
          skillKey,
        },
      },
      update: {
        value,
        reliability: "medium",
        sampleCount: {
          increment: 1,
        },
      },
      create: {
        studentId: session.studentId,
        date: day,
        skillKey,
        value,
        reliability: "medium",
        sampleCount: 1,
      },
    });
  }

  return {
    stage: result.stage,
    average: result.average,
    confidence: result.confidence,
    skillSnapshot: result.skillSnapshot,
  };
}

export async function getPlacementSession(studentId: string, sessionId: string) {
  const session = await prisma.placementSession.findUnique({ where: { id: sessionId } });
  if (!session || session.studentId !== studentId) return null;
  const question = session.status === "started" ? getPlacementQuestionByIndex(session.currentIndex) : null;
  return {
    session,
    question,
    totalQuestions: QUESTIONS.length,
  };
}
