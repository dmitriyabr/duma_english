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
import { nextTargetNodesForStudent } from "./gse/planner";
import { projectLearnerStageFromGse, refreshLearnerProfileFromGse, DomainStages } from "./gse/stageProjection";

const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
const COLD_START_TARGET_ATTEMPTS = 8;
const CARRYOVER_STAGE_INDEX = 4; // B2+
const CARRYOVER_CONFIDENCE = 0.8;

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
  domainStages: DomainStages;
  pronunciationScore: number | null;
};

type VocabularyItem = {
  lemma: string;
  nextReviewAt: Date | null;
  status: string;
};

function isStage(value: string): value is CEFRStage {
  return STAGE_ORDER.includes(value as CEFRStage);
}

function isAgeBand(value: string): value is AgeBand {
  return value === "6-8" || value === "9-11" || value === "12-14";
}

function stageIndex(stage: CEFRStage) {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

function dedupe<T>(items: T[]) {
  return Array.from(new Set(items));
}

function mergeTargetWords(primary: string[], fallback: string[], limit = 6) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of [...primary, ...fallback]) {
    const normalized = String(word || "").toLowerCase().trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
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

function mapNodeSkillToSkillKey(skill: string | null | undefined): SkillKey {
  if (skill === "vocabulary") return "vocabulary";
  if (skill === "grammar") return "task_completion";
  if (skill === "speaking") return "fluency";
  if (skill === "listening") return "task_completion";
  if (skill === "writing") return "task_completion";
  return "fluency";
}

function isPlacementAttemptMeta(metaJson: unknown) {
  if (!metaJson || typeof metaJson !== "object") return false;
  return Boolean((metaJson as Record<string, unknown>).isPlacement);
}

async function deriveWeakestSkillsFromNodes(studentId: string): Promise<SkillKey[]> {
  const nodes = await nextTargetNodesForStudent(studentId, 10);
  const ranked = dedupe(nodes.map((node) => mapNodeSkillToSkillKey(node.skill)).filter(Boolean));
  if (ranked.length === 0) return ["pronunciation", "vocabulary"];
  if (ranked.length === 1) return [ranked[0], ranked[0] === "pronunciation" ? "fluency" : "pronunciation"];
  return ranked.slice(0, 2);
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
    bySkill[taskTypeToPrimarySkill(attempt.task.type)] += 1;
  }
  const nextSkill = (Object.entries(bySkill).sort((a, b) => a[1] - b[1])[0]?.[0] ||
    "pronunciation") as SkillKey;
  return {
    active: completed < COLD_START_TARGET_ATTEMPTS,
    completed,
    nextSkill,
  };
}

async function getDueVocabulary(studentId: string): Promise<VocabularyItem[]> {
  const now = new Date();
  const rows = await prisma.studentVocabulary.findMany({
    where: {
      studentId,
      OR: [{ status: "learning", nextReviewAt: { lte: now } }, { status: "new" }],
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

async function recentFatigue(studentId: string) {
  const attempts = await prisma.attempt.findMany({
    where: { studentId },
    include: { task: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return attempts.map((attempt) => attempt.task.type);
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

async function applyDominanceCarryoverIfNeeded(params: {
  studentId: string;
  stage: CEFRStage;
  confidence: number;
}) {
  if (stageIndex(params.stage) < CARRYOVER_STAGE_INDEX) return false;
  if (params.confidence < CARRYOVER_CONFIDENCE) return false;

  const nodes = await prisma.gseNode.findMany({
    where: {
      gseCenter: { lte: 42 },
      skill: { in: ["speaking", "vocabulary", "grammar", "listening", "writing"] },
    },
    select: { nodeId: true },
    take: 260,
  });
  if (nodes.length === 0) return false;
  const now = new Date();
  const nodeIds = nodes.map((node) => node.nodeId);
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
      decayStateJson: { dominanceCarryover: true, source: "gse_only" },
      calculationVersion: "gse-carryover-v1",
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
      decayStateJson: { dominanceCarryover: true, source: "gse_only" },
      calculationVersion: "gse-carryover-v1",
    },
  });
  return true;
}

export async function ensureLearnerProfile(studentId: string, preferredAgeBand?: AgeBand) {
  const existing = await prisma.learnerProfile.findUnique({ where: { studentId } });
  if (existing) return existing;
  return prisma.learnerProfile.create({
    data: {
      studentId,
      stage: "A0",
      stageSource: "gse_projection",
      stageEvidenceJson: Prisma.DbNull,
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
  const beforeStage = isStage(profile.stage) ? profile.stage : "A0";

  let projection = await refreshLearnerProfileFromGse({
    studentId,
    reason: "runtime_recompute",
  });

  const carryoverApplied = await applyDominanceCarryoverIfNeeded({
    studentId,
    stage: projection.stage,
    confidence: projection.confidence,
  });
  if (carryoverApplied) {
    projection = await refreshLearnerProfileFromGse({
      studentId,
      reason: "runtime_recompute_carryover",
      carryoverSummary: { carryoverApplied: true, source: "gse_only" },
    });
  }

  await prisma.promotionAudit.create({
    data: {
      studentId,
      fromStage: beforeStage,
      targetStage: projection.stage,
      promoted: stageIndex(projection.stage) > stageIndex(beforeStage),
      blockedByNodes: projection.blockedByNodes,
      reasonsJson: {
        source: "gse_only",
        confidence: projection.confidence,
        currentStageStats: projection.currentStageStats,
        targetStageStats: projection.targetStageStats,
        stressGate: projection.stressGate,
      } as Prisma.InputJsonValue,
      readinessScore: projection.score,
    },
  });

  return {
    stage: projection.stage,
    suggestedStage: projection.stage,
    promoted: stageIndex(projection.stage) > stageIndex(beforeStage),
    blockedByNodes: projection.blockedByNodes,
    readinessScore: projection.score,
    averageMastery: projection.score,
    strongStreak: 0,
    carryoverApplied,
    mastery: projection.derivedSkills.map((item) => ({
      skillKey: item.skillKey,
      masteryScore: item.current ?? 0,
      reliability: item.reliability,
      evidenceCount: item.sampleCount,
    })),
  };
}

export async function buildLearningPlan(params: {
  studentId: string;
  requestedType?: string | null;
}): Promise<LearningPlan> {
  const profile = await ensureLearnerProfile(params.studentId);
  const projection = await projectLearnerStageFromGse(params.studentId);
  const stage = projection.stage;
  const ageBand = isAgeBand(profile.ageBand) ? profile.ageBand : "9-11";
  const cycleWeek = Math.max(1, Math.min(12, profile.cycleWeek || 1));
  const curriculumWeek = getCurriculumWeek({ stage, ageBand, week: cycleWeek });
  const weakestSkills = await deriveWeakestSkillsFromNodes(params.studentId);
  const coldStart = await getColdStartState(params.studentId);
  const dueWords = await getDueVocabulary(params.studentId);
  if (dueWords.length === 0 && curriculumWeek.targetWords.length > 0) {
    await seedVocabularyIfNeeded(params.studentId, curriculumWeek.targetWords, curriculumWeek.topicIds[0]);
  }

  const dueWordLemmas = dueWords.map((item) => item.lemma);
  const targetWords =
    dueWordLemmas.length === 0
      ? curriculumWeek.targetWords.slice(0, 6)
      : mergeTargetWords(dueWordLemmas.slice(0, 4), curriculumWeek.targetWords, 6);
  const diagnosticSkill = coldStart.active ? coldStart.nextSkill : weakestSkills[0];
  const orderedSkills = dedupe([diagnosticSkill, ...weakestSkills]) as SkillKey[];
  const candidateTypes = dedupe([
    coldStart.active ? diagnosticTaskForSkill(diagnosticSkill) : "",
    ...tasksForSkills(orderedSkills),
    ...tasksForBlueprints(curriculumWeek.taskBlueprints),
  ]).filter(Boolean);
  const fatigue = await recentFatigue(params.studentId);
  // Gate productive tasks by weakest productive domain
  const gateStage = [projection.domainStages.grammar.stage, projection.domainStages.communication.stage]
    .reduce<CEFRStage>((min, s) => stageIndex(s) < stageIndex(min) ? s : min, stage);
  const allowed = allowedTasksForStage(gateStage);
  const selectedType = pickTaskType({
    candidateTypes,
    allowed,
    fatigue,
    requestedType: params.requestedType,
  });

  const reason = coldStart.active
    ? `Diagnostic mode ${coldStart.completed}/${COLD_START_TARGET_ATTEMPTS}: exploring ${diagnosticSkill} via GSE nodes.`
    : `Selected ${selectedType} from weakest GSE objectives for stage ${stage}.`;

  return {
    studentId: params.studentId,
    currentStage: stage,
    ageBand,
    cycleWeek,
    weakestSkills: orderedSkills.slice(0, 2),
    targetWords,
    recommendedTaskTypes: dedupe([selectedType, ...candidateTypes]).filter((type) => allowed.includes(type)),
    nextTaskReason: reason,
    skillMatrix: getSkillMatrix(stage, ageBand),
    domainStages: projection.domainStages,
    pronunciationScore: projection.pronunciationScore,
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
