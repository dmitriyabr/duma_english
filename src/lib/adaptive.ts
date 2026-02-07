import { Prisma } from "@prisma/client";
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
const STAGE_ORDER = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
const COLD_START_TARGET_ATTEMPTS = 8;
const STRONG_STREAK_JUMP_1 = 2;
const STRONG_STREAK_JUMP_2 = 3;
const STRONG_SCORE_THRESHOLD = 78;

const DEFAULT_MASTERY = 50;
const STAGE_GATE: Record<CEFRStage, string[]> = {
  A0: ["read_aloud", "target_vocab", "qa_prompt", "filler_control"],
  A1: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk"],
  A2: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk", "speech_builder"],
  B1: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk", "speech_builder"],
  B2: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk", "speech_builder"],
  C1: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk", "speech_builder"],
  C2: ["read_aloud", "target_vocab", "qa_prompt", "filler_control", "role_play", "topic_talk", "speech_builder"],
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

type AttemptScoreShape = {
  speechScore?: number | null;
  taskScore?: number | null;
  languageScore?: number | null;
  reliability?: string | null;
};

function isStage(value: string): value is CEFRStage {
  return (
    value === "A0" ||
    value === "A1" ||
    value === "A2" ||
    value === "B1" ||
    value === "B2" ||
    value === "C1" ||
    value === "C2"
  );
}

function isAgeBand(value: string): value is AgeBand {
  return value === "6-8" || value === "9-11" || value === "12-14";
}

function stageAt(index: number): CEFRStage {
  const clamped = Math.max(0, Math.min(STAGE_ORDER.length - 1, index));
  return STAGE_ORDER[clamped];
}

function lowerBoundForStage(stage: CEFRStage) {
  if (stage === "A0") return 0;
  if (stage === "A1") return 45;
  if (stage === "A2") return 58;
  if (stage === "B1") return 70;
  if (stage === "B2") return 80;
  if (stage === "C1") return 88;
  return 93;
}

function taskTypeToPrimarySkill(taskType: string): SkillKey {
  if (taskType === "read_aloud") return "pronunciation";
  if (taskType === "filler_control") return "tempo_control";
  if (taskType === "target_vocab") return "vocabulary";
  if (taskType === "qa_prompt" || taskType === "role_play" || taskType === "speech_builder") {
    return "task_completion";
  }
  return "fluency";
}

function diagnosticTaskForSkill(skill: SkillKey) {
  if (skill === "pronunciation") return "read_aloud";
  if (skill === "tempo_control") return "filler_control";
  if (skill === "vocabulary") return "target_vocab";
  if (skill === "task_completion") return "qa_prompt";
  return "topic_talk";
}

function isPlacementAttemptMeta(metaJson: unknown) {
  if (!metaJson || typeof metaJson !== "object") return false;
  return Boolean((metaJson as Record<string, unknown>).isPlacement);
}

function safeScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strongAttempt(attemptScores: AttemptScoreShape) {
  const speech = safeScore(attemptScores.speechScore);
  const task = safeScore(attemptScores.taskScore);
  const language = safeScore(attemptScores.languageScore);
  if (attemptScores.reliability === "low") return false;
  if (speech === null || task === null) return false;
  const languageOk = language === null || language >= STRONG_SCORE_THRESHOLD - 3;
  return speech >= STRONG_SCORE_THRESHOLD && task >= STRONG_SCORE_THRESHOLD && languageOk;
}

function strongStreakFromAttempts(
  attempts: Array<{ scoresJson: Prisma.JsonValue | null }>
) {
  let streak = 0;
  for (const attempt of attempts) {
    const scores = (attempt.scoresJson || {}) as AttemptScoreShape;
    if (!strongAttempt(scores)) break;
    streak += 1;
  }
  return streak;
}

async function applyDominanceCarryoverIfNeeded(params: {
  studentId: string;
  stage: CEFRStage;
  averageMastery: number;
  strongStreak: number;
}) {
  if (stageIndex(params.stage) < stageIndex("B2")) return false;
  if (params.strongStreak < 2 && params.averageMastery < 82) return false;

  const nodes = await prisma.gseNode.findMany({
    where: {
      gseCenter: { lte: 42 },
      skill: { in: ["speaking", "vocabulary", "grammar", "listening", "writing"] },
    },
    select: { nodeId: true },
    take: 260,
  });
  if (nodes.length === 0) return false;
  const nodeIds = nodes.map((node) => node.nodeId);
  const now = new Date();
  await prisma.studentGseMastery.createMany({
    data: nodeIds.map((nodeId) => ({
      studentId: params.studentId,
      nodeId,
      masteryScore: 76,
      masteryMean: 76,
      masterySigma: 16,
      decayedMastery: 76,
      halfLifeDays: 24,
      evidenceCount: 1,
      reliability: "medium",
      lastEvidenceAt: now,
      decayStateJson: { dominanceCarryover: true, source: "hidden-cold-start" },
      calculationVersion: "hidden-carryover-v1",
    })),
    skipDuplicates: true,
  });
  await prisma.studentGseMastery.updateMany({
    where: {
      studentId: params.studentId,
      nodeId: { in: nodeIds },
      masteryScore: { lt: 76 },
    },
    data: {
      masteryScore: 76,
      masteryMean: 76,
      masterySigma: 16,
      decayedMastery: 76,
      reliability: "medium",
      lastEvidenceAt: now,
      calculationVersion: "hidden-carryover-v1",
    },
  });
  return true;
}

async function getColdStartState(studentId: string) {
  const attempts = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    include: { task: { select: { type: true, metaJson: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const nonPlacement = attempts.filter((attempt) => !isPlacementAttemptMeta(attempt.task.metaJson));
  const completed = nonPlacement.length;
  const bySkill: Record<SkillKey, number> = {
    pronunciation: 0,
    fluency: 0,
    tempo_control: 0,
    vocabulary: 0,
    task_completion: 0,
  };
  for (const attempt of nonPlacement) {
    const skill = taskTypeToPrimarySkill(attempt.task.type);
    bySkill[skill] += 1;
  }
  let nextSkill: SkillKey = "pronunciation";
  let minCount = Number.POSITIVE_INFINITY;
  for (const skill of CORE_SKILLS) {
    if (bySkill[skill] < minCount) {
      minCount = bySkill[skill];
      nextSkill = skill;
    }
  }
  return {
    active: completed < COLD_START_TARGET_ATTEMPTS,
    completed,
    nextSkill,
    bySkill,
    strongStreak: strongStreakFromAttempts(nonPlacement),
  };
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

  const suggestedStage: CEFRStage =
    averageMastery >= 93
      ? "C2"
      : averageMastery >= 88
      ? "C1"
      : averageMastery >= 80
      ? "B2"
      : averageMastery >= 70
      ? "B1"
      : averageMastery >= 58
      ? "A2"
      : averageMastery >= 45
      ? "A1"
      : "A0";
  const currentStage: CEFRStage = isStage(profile.stage) ? profile.stage : "A0";
  let stageToPersist: CEFRStage = currentStage;
  let promoted = false;
  let blockedByNodes: string[] = [];
  let readinessScore = 100;
  const recentAttempts = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    include: { task: { select: { metaJson: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const recentNonPlacement = recentAttempts.filter((attempt) => !isPlacementAttemptMeta(attempt.task.metaJson));
  const strongStreak = strongStreakFromAttempts(recentNonPlacement);

  if (stageIndex(suggestedStage) > stageIndex(currentStage)) {
    const currentIdx = stageIndex(currentStage);
    const suggestedIdx = stageIndex(suggestedStage);
    const jumpLimit = strongStreak >= STRONG_STREAK_JUMP_2 ? 2 : 1;
    const maxTargetIdx = Math.min(suggestedIdx, currentIdx + jumpLimit);
    const candidateTargets: CEFRStage[] = [];
    for (let idx = maxTargetIdx; idx > currentIdx; idx -= 1) {
      candidateTargets.push(stageAt(idx));
    }

    const recentSkillRows = await prisma.studentSkillDaily.findMany({
      where: {
        studentId,
        date: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        skillKey: { in: ["pronunciation", "fluency", "task_completion"] },
      },
      orderBy: [{ skillKey: "asc" }, { date: "asc" }],
    });
    const reliabilityGate = masteryRows
      .filter((row) => ["pronunciation", "fluency", "task_completion"].includes(row.skillKey))
      .every((row) => row.reliability !== "low");
    const stabilityGate = recentSkillRows.every((row, index, arr) => {
      if (index === 0) return true;
      const prev = arr[index - 1];
      if (prev.skillKey !== row.skillKey) return true;
      return row.value + 5 >= prev.value;
    });

    for (const targetStage of candidateTargets) {
      const targetRange = rangeForStage(targetStage);
      const nodeRows = await prisma.studentGseMastery.findMany({
        where: {
          studentId,
          node: {
            gseCenter: {
              gte: targetRange.min,
              lte: targetRange.max,
            },
          },
        },
        include: { node: { select: { nodeId: true } } },
      });
      const covered = nodeRows.filter(
        (row) => (row.decayedMastery ?? row.masteryMean ?? row.masteryScore) >= 70
      ).length;
      const coverageRatio = nodeRows.length > 0 ? covered / nodeRows.length : 0;
      const fallbackGate =
        nodeRows.length === 0 &&
        averageMastery >= lowerBoundForStage(targetStage) &&
        strongStreak >= STRONG_STREAK_JUMP_1;
      promoted =
        reliabilityGate &&
        stabilityGate &&
        (coverageRatio >= 0.62 || fallbackGate);
      blockedByNodes = nodeRows
        .filter((row) => (row.decayedMastery ?? row.masteryMean ?? row.masteryScore) < 60)
        .slice(0, 8)
        .map((row) => row.nodeId);
      readinessScore = Number(
        Math.min(
          100,
          Math.max(
            0,
            coverageRatio * 60 + (reliabilityGate ? 20 : 8) + (stabilityGate ? 20 : 8)
          )
        ).toFixed(1)
      );
      if (promoted) {
        stageToPersist = targetStage;
        break;
      }
    }

    await prisma.promotionAudit.create({
      data: {
        studentId,
        fromStage: currentStage,
        targetStage:
          stageToPersist === currentStage
            ? candidateTargets[candidateTargets.length - 1] || currentStage
            : stageToPersist,
        promoted,
        blockedByNodes,
        reasonsJson: {
          strongStreak,
          reliabilityGate,
          stabilityGate,
          suggestedStage,
        },
        readinessScore,
      },
    });
  }

  const carryoverApplied = await applyDominanceCarryoverIfNeeded({
    studentId,
    stage: stageToPersist,
    averageMastery: Number(averageMastery.toFixed(2)),
    strongStreak,
  });

  await prisma.learnerProfile.update({
    where: { id: profile.id },
    data: {
      stage: stageToPersist,
      placementScore: Number(averageMastery.toFixed(2)),
      placementConfidence: masteryRows.length >= 5 ? 0.8 : 0.55,
      placementCarryoverJson: carryoverApplied
        ? ({
            carryoverApplied: true,
            source: "hidden-cold-start",
          } as Prisma.InputJsonValue)
        : undefined,
    },
  });

  return {
    stage: stageToPersist,
    suggestedStage,
    promoted,
    blockedByNodes,
    readinessScore,
    averageMastery: Number(averageMastery.toFixed(2)),
    strongStreak,
    carryoverApplied,
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

function rangeForStage(stage: string) {
  if (stage === "A0") return { min: 10, max: 21 };
  if (stage === "A1") return { min: 22, max: 29 };
  if (stage === "A2") return { min: 30, max: 42 };
  if (stage === "B1") return { min: 43, max: 58 };
  if (stage === "B2") return { min: 59, max: 75 };
  if (stage === "C1") return { min: 76, max: 84 };
  return { min: 85, max: 90 };
}

function stageIndex(stage: string) {
  const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return idx === -1 ? 0 : idx;
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
  const coldStart = await getColdStartState(params.studentId);
  const dueWords = await getDueVocabulary(params.studentId);
  if (dueWords.length === 0 && curriculumWeek.targetWords.length > 0) {
    await seedVocabularyIfNeeded(params.studentId, curriculumWeek.targetWords, curriculumWeek.topicIds[0]);
  }

  const targetWords = (dueWords.length > 0 ? dueWords.map((item) => item.lemma) : curriculumWeek.targetWords).slice(0, 6);
  const diagnosticSkill = coldStart.active ? coldStart.nextSkill : weakestSkills[0];
  const orderedSkills = dedupe([diagnosticSkill, ...weakestSkills]) as SkillKey[];
  const diagnosticType = diagnosticTaskForSkill(diagnosticSkill);
  const candidateTypes = dedupe([
    coldStart.active ? diagnosticType : "",
    ...tasksForSkills(orderedSkills),
    ...tasksForBlueprints(curriculumWeek.taskBlueprints),
  ]).filter(Boolean);
  const fatigue = await recentFatigue(params.studentId);
  const allowed = allowedTasksForStage(stage);
  const selectedType = pickTaskType({
    candidateTypes,
    allowed,
    fatigue,
    requestedType: params.requestedType,
  });

  const skillMatrix = getSkillMatrix(stage, ageBand);
  const reason = coldStart.active
    ? `Diagnostic mode ${coldStart.completed}/${COLD_START_TARGET_ATTEMPTS}: probing ${diagnosticSkill}.`
    : `Selected ${selectedType} to improve ${weakestSkills.join(", ")} for stage ${stage}.`;
  return {
    studentId: params.studentId,
    currentStage: stage,
    ageBand,
    cycleWeek,
    weakestSkills: orderedSkills.slice(0, 2),
    targetWords,
    recommendedTaskTypes: dedupe([selectedType, ...candidateTypes]).filter((type) => allowed.includes(type)),
    nextTaskReason: reason,
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
