import { prisma } from "./db";
import {
  AgeBand,
  BlueprintType,
  CEFRStage,
  SkillKey,
  getCurriculumWeek,
  getSkillMatrix,
} from "./curriculum";

const CORE_SKILLS: SkillKey[] = [
  "pronunciation",
  "fluency",
  "tempo_control",
  "vocabulary",
  "task_completion",
];

const DEFAULT_MASTERY = 50;
const STAGE_GATE: Record<CEFRStage, string[]> = {
  A0: ["read_aloud", "target_vocab", "qa_prompt", "filler_control"],
  A1: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk"],
  A2: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk", "speech_builder"],
  B1: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk", "speech_builder"],
};

const SKILL_TO_TASKS: Record<SkillKey, string[]> = {
  pronunciation: ["read_aloud", "filler_control"],
  fluency: ["topic_talk", "filler_control", "qa_prompt"],
  tempo_control: ["filler_control", "speech_builder", "topic_talk"],
  vocabulary: ["target_vocab", "topic_talk", "qa_prompt"],
  task_completion: ["qa_prompt", "role_play", "speech_builder"],
};

const BLUEPRINT_TO_TASKS: Record<BlueprintType, string[]> = {
  guided_practice: ["read_aloud", "qa_prompt"],
  vocab_activation: ["target_vocab", "topic_talk"],
  dialogue_turn: ["role_play", "qa_prompt"],
  speech_structure: ["speech_builder", "topic_talk"],
  review: ["filler_control", "topic_talk"],
};

export type LearningPlan = {
  studentId: string;
  currentStage: CEFRStage;
  ageBand: AgeBand;
  cycleWeek: number;
  weakestSkills: SkillKey[];
  targetWords: string[];
  recommendedTaskTypes: string[];
  nextTaskReason: string;
  skillMatrix: ReturnType<typeof getSkillMatrix>;
};

type VocabularyItem = {
  lemma: string;
  nextReviewAt: Date | null;
  status: string;
};

function isStage(value: string): value is CEFRStage {
  return value === "A0" || value === "A1" || value === "A2" || value === "B1";
}

function isAgeBand(value: string): value is AgeBand {
  return value === "6-8" || value === "9-11" || value === "12-14";
}

export async function ensureLearnerProfile(studentId: string, preferredAgeBand?: AgeBand) {
  const existing = await prisma.learnerProfile.findUnique({ where: { studentId } });
  if (existing) return existing;

  return prisma.learnerProfile.create({
    data: {
      studentId,
      stage: "A0",
      ageBand: preferredAgeBand || "9-11",
      placementScore: 35,
      placementConfidence: 0.4,
      activeTrack: "balanced_convo_speech",
      cycleWeek: 1,
    },
  });
}

export async function recomputeMastery(studentId: string) {
  const profile = await ensureLearnerProfile(studentId);
  const since = new Date();
  since.setDate(since.getDate() - 28);

  const rows = await prisma.studentSkillDaily.findMany({
    where: { studentId, date: { gte: since } },
    orderBy: [{ skillKey: "asc" }, { date: "asc" }],
  });

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.skillKey) || [];
    list.push(row);
    grouped.set(row.skillKey, list);
  }

  for (const skillKey of CORE_SKILLS) {
    const samples = grouped.get(skillKey) || [];
    const average = samples.length
      ? Number((samples.reduce((sum, item) => sum + item.value, 0) / samples.length).toFixed(2))
      : DEFAULT_MASTERY;
    const reliability = samples.some((item) => item.reliability === "high")
      ? "high"
      : samples.some((item) => item.reliability === "medium")
      ? "medium"
      : "low";

    await prisma.studentSkillMastery.upsert({
      where: { studentId_skillKey: { studentId, skillKey } },
      update: {
        masteryScore: average,
        evidenceCount: samples.reduce((sum, item) => sum + item.sampleCount, 0),
        reliability,
        lastAssessedAt: new Date(),
      },
      create: {
        studentId,
        skillKey,
        masteryScore: average,
        evidenceCount: samples.reduce((sum, item) => sum + item.sampleCount, 0),
        reliability,
        lastAssessedAt: new Date(),
      },
    });
  }

  const masteryRows = await prisma.studentSkillMastery.findMany({ where: { studentId } });
  const averageMastery =
    masteryRows.length > 0
      ? masteryRows.reduce((sum, row) => sum + row.masteryScore, 0) / masteryRows.length
      : DEFAULT_MASTERY;

  const nextStage: CEFRStage =
    averageMastery >= 82 ? "B1" : averageMastery >= 68 ? "A2" : averageMastery >= 50 ? "A1" : "A0";
  await prisma.learnerProfile.update({
    where: { id: profile.id },
    data: {
      stage: nextStage,
      placementScore: Number(averageMastery.toFixed(2)),
      placementConfidence: masteryRows.length >= 5 ? 0.8 : 0.55,
    },
  });

  return {
    stage: nextStage,
    averageMastery: Number(averageMastery.toFixed(2)),
    mastery: masteryRows.map((row) => ({
      skillKey: row.skillKey,
      masteryScore: row.masteryScore,
      reliability: row.reliability,
      evidenceCount: row.evidenceCount,
    })),
  };
}

async function getWeakestSkills(studentId: string): Promise<SkillKey[]> {
  let mastery = await prisma.studentSkillMastery.findMany({ where: { studentId } });
  if (mastery.length === 0) {
    await recomputeMastery(studentId);
    mastery = await prisma.studentSkillMastery.findMany({ where: { studentId } });
  }

  if (mastery.length === 0) return [...CORE_SKILLS];
  return mastery
    .sort((a, b) => a.masteryScore - b.masteryScore)
    .map((row) => row.skillKey as SkillKey)
    .filter((key): key is SkillKey => CORE_SKILLS.includes(key))
    .slice(0, 2);
}

async function getDueVocabulary(studentId: string): Promise<VocabularyItem[]> {
  const now = new Date();
  const rows = await prisma.studentVocabulary.findMany({
    where: {
      studentId,
      OR: [
        { status: "learning", nextReviewAt: { lte: now } },
        { status: "new" },
      ],
    },
    orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "asc" }],
    take: 10,
  });
  return rows.map((row) => ({
    lemma: row.lemma,
    nextReviewAt: row.nextReviewAt,
    status: row.status,
  }));
}

async function seedVocabularyIfNeeded(studentId: string, words: string[], topicId?: string) {
  for (const word of words.slice(0, 10)) {
    await prisma.studentVocabulary.upsert({
      where: { studentId_lemma: { studentId, lemma: word.toLowerCase() } },
      update: {},
      create: {
        studentId,
        lemma: word.toLowerCase(),
        status: "new",
        nextReviewAt: new Date(),
        sourceTopicId: topicId,
      },
    });
  }
}

function dedupe<T>(items: T[]) {
  return Array.from(new Set(items));
}

function allowedTasksForStage(stage: CEFRStage) {
  return STAGE_GATE[stage];
}

function tasksForBlueprints(blueprints: BlueprintType[]) {
  return dedupe(blueprints.flatMap((blueprint) => BLUEPRINT_TO_TASKS[blueprint] || []));
}

function tasksForSkills(skills: SkillKey[]) {
  return dedupe(skills.flatMap((skill) => SKILL_TO_TASKS[skill] || []));
}

async function recentFatigue(studentId: string) {
  const attempts = await prisma.attempt.findMany({
    where: { studentId },
    include: { task: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return attempts.map((attempt) => attempt.task.type);
}

function pickTaskType(params: {
  candidateTypes: string[];
  allowed: string[];
  fatigue: string[];
  requestedType?: string | null;
}) {
  if (params.requestedType && params.allowed.includes(params.requestedType)) {
    return params.requestedType;
  }

  const filtered = params.candidateTypes.filter((type) => params.allowed.includes(type));
  const noFatigue = filtered.filter((type) => !params.fatigue.slice(0, 2).includes(type));
  if (noFatigue.length > 0) return noFatigue[0];
  if (filtered.length > 0) return filtered[0];
  return params.allowed[0];
}

export async function buildLearningPlan(params: {
  studentId: string;
  requestedType?: string | null;
}) : Promise<LearningPlan> {
  const profile = await ensureLearnerProfile(params.studentId);
  const stage = isStage(profile.stage) ? profile.stage : "A0";
  const ageBand = isAgeBand(profile.ageBand) ? profile.ageBand : "9-11";
  const cycleWeek = Math.max(1, Math.min(12, profile.cycleWeek || 1));
  const curriculumWeek = getCurriculumWeek({ stage, ageBand, week: cycleWeek });
  const weakestSkills = await getWeakestSkills(params.studentId);
  const dueWords = await getDueVocabulary(params.studentId);
  if (dueWords.length === 0 && curriculumWeek.targetWords.length > 0) {
    await seedVocabularyIfNeeded(params.studentId, curriculumWeek.targetWords, curriculumWeek.topicIds[0]);
  }

  const targetWords = (dueWords.length > 0 ? dueWords.map((item) => item.lemma) : curriculumWeek.targetWords).slice(0, 6);
  const candidateTypes = dedupe([
    ...tasksForSkills(weakestSkills),
    ...tasksForBlueprints(curriculumWeek.taskBlueprints),
  ]);
  const fatigue = await recentFatigue(params.studentId);
  const allowed = allowedTasksForStage(stage);
  const selectedType = pickTaskType({
    candidateTypes,
    allowed,
    fatigue,
    requestedType: params.requestedType,
  });

  const skillMatrix = getSkillMatrix(stage, ageBand);
  return {
    studentId: params.studentId,
    currentStage: stage,
    ageBand,
    cycleWeek,
    weakestSkills,
    targetWords,
    recommendedTaskTypes: dedupe([selectedType, ...candidateTypes]).filter((type) => allowed.includes(type)),
    nextTaskReason: `Selected ${selectedType} to improve ${weakestSkills.join(", ")} for stage ${stage}.`,
    skillMatrix,
  };
}

export async function bumpCycleWeek(studentId: string) {
  const profile = await ensureLearnerProfile(studentId);
  const next = profile.cycleWeek >= 12 ? 1 : profile.cycleWeek + 1;
  return prisma.learnerProfile.update({
    where: { id: profile.id },
    data: { cycleWeek: next },
  });
}
