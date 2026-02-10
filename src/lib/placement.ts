import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { CEFRStage, SkillKey } from "./curriculum";
import { mapStageToGseRange } from "./gse/utils";
import { projectLearnerStageFromGse, refreshLearnerProfileFromGse, gseBandFromCenter } from "./gse/stageProjection";
import { generateTaskSpec } from "./taskGenerator";
import { assignTaskTargetsFromCatalog } from "./gse/planner";

export type PlacementItemView = {
  id: string;
  skillKey: SkillKey;
  stageBand: string;
  taskType: string;
  prompt: string;
  hint: string;
  expectedMinWords: number;
  assessmentMode: "pa" | "stt";
  maxDurationSec: number;
  difficulty: number;
  discrimination: number;
  gseTargets: string[];
};

export type PlacementAnswerInput = {
  itemId?: string;
  questionId?: string; // backward compatibility
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
    grammarAccuracy?: number | null;
  };
};

const MIN_QUESTIONS = 6;
const MAX_QUESTIONS = 14;
const SIGMA_STOP = 0.35;
const CARRYOVER_CONFIDENCE = 0.8;
const CARRYOVER_MIN_STAGE_INDEX = 4; // B2

const CORE_SKILLS: SkillKey[] = [
  "pronunciation",
  "fluency",
  "tempo_control",
  "vocabulary",
  "task_completion",
];

const STAGES = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

function stageIndex(stage: string) {
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return idx === -1 ? 0 : idx;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function logistic(x: number) {
  return 1 / (1 + Math.exp(-x));
}

function round(value: number, digits = 3) {
  const p = Math.pow(10, digits);
  return Math.round(value * p) / p;
}

function thetaFromStage(stage: string) {
  if (stage === "A0") return -2.1;
  if (stage === "A1") return -1.35;
  if (stage === "A2") return -0.55;
  if (stage === "B1") return 0.35;
  if (stage === "B2") return 1.1;
  if (stage === "C1") return 1.9;
  return 2.6;
}

function stageFromTheta(theta: number) {
  if (theta < -1.7) return "A0";
  if (theta < -0.95) return "A1";
  if (theta < -0.1) return "A2";
  if (theta < 0.85) return "B1";
  if (theta < 1.6) return "B2";
  if (theta < 2.35) return "C1";
  return "C2";
}

function scoreFromObserved(skillKey: SkillKey, observed?: PlacementAnswerInput["observedMetrics"]) {
  if (!observed) return null;
  const speech = typeof observed.speechScore === "number" ? observed.speechScore : null;
  const task = typeof observed.taskScore === "number" ? observed.taskScore : null;
  const language = typeof observed.languageScore === "number" ? observed.languageScore : null;
  const pronunciation = typeof observed.pronunciation === "number" ? observed.pronunciation : speech;
  const fluency = typeof observed.fluency === "number" ? observed.fluency : speech;
  const tempo =
    typeof observed.speechRate === "number"
      ? observed.speechRate >= 100 && observed.speechRate <= 150
        ? 85
        : observed.speechRate >= 90 && observed.speechRate <= 165
        ? 72
        : 56
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

  if (skillKey === "pronunciation" && pronunciation !== null) return clamp(pronunciation, 0, 100);
  if (skillKey === "fluency" && fluency !== null) return clamp(fluency, 0, 100);
  if (skillKey === "tempo_control" && tempo !== null) return clamp(tempo, 0, 100);
  if (skillKey === "vocabulary" && vocab !== null) return clamp(vocab, 0, 100);
  if (skillKey === "task_completion" && completion !== null) return clamp(completion, 0, 100);
  if (skillKey === "vocabulary" && typeof observed.grammarAccuracy === "number") {
    return clamp(observed.grammarAccuracy, 0, 100);
  }
  const weighted = [speech, task, language].filter((v): v is number => typeof v === "number");
  if (weighted.length === 0) return null;
  return clamp(weighted.reduce((s, v) => s + v, 0) / weighted.length, 0, 100);
}

function scoreFromTranscript(item: PlacementItemView, transcript?: string, selfRating?: number) {
  const text = (transcript || "").trim();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const ratio = item.expectedMinWords > 0 ? words.length / item.expectedMinWords : 1;
  const lengthScore = clamp(ratio * 65, 0, 100);
  const self = typeof selfRating === "number" ? clamp(selfRating, 1, 5) : 3;
  const selfScore = ((self - 1) / 4) * 35;
  return clamp(lengthScore + selfScore, 0, 100);
}

export function scorePlacementAnswer(item: PlacementItemView, answer: PlacementAnswerInput) {
  const observed = scoreFromObserved(item.skillKey, answer.observedMetrics);
  if (observed !== null) return Math.round(observed);
  return Math.round(scoreFromTranscript(item, answer.transcript, answer.selfRating));
}

function itemInformation(theta: number, difficulty: number, discrimination: number) {
  const a = clamp(discrimination, 0.6, 2);
  const p = logistic(a * (theta - difficulty));
  return a * a * p * (1 - p);
}

function updateAbility(params: {
  theta: number;
  sigma: number;
  itemDifficulty: number;
  itemDiscrimination: number;
  itemScore: number; // 0..1
}) {
  const a = clamp(params.itemDiscrimination, 0.6, 2);
  const p = logistic(a * (params.theta - params.itemDifficulty));
  const gradient = a * (params.itemScore - p);
  const step = clamp(0.22 * params.sigma + 0.08, 0.08, 0.36);
  const delta = clamp(step * gradient, -0.45, 0.45);
  const nextTheta = clamp(params.theta + delta, -3, 3);
  const info = itemInformation(params.theta, params.itemDifficulty, a);
  const sigmaDecay = clamp(0.12 + info * 0.42, 0.1, 0.35);
  const nextSigma = clamp(params.sigma * (1 - sigmaDecay), 0.2, 1.2);
  return {
    theta: round(nextTheta),
    sigma: round(nextSigma),
    p: round(p),
  };
}

function confidenceFromSigma(params: { sigma: number; skillCoverage: number }) {
  const sigmaComponent = clamp(1 - (params.sigma - 0.2) / 1.0, 0, 1);
  const confidence = 0.45 + sigmaComponent * 0.45 + clamp(params.skillCoverage, 0, 1) * 0.1;
  return round(clamp(confidence, 0, 0.99), 2);
}

function taskTypeForSkill(skill: SkillKey) {
  if (skill === "pronunciation") return "read_aloud";
  if (skill === "vocabulary") return "target_vocab";
  if (skill === "task_completion") return "qa_prompt";
  if (skill === "tempo_control") return "filler_control";
  return "topic_talk";
}

function defaultPromptFor(skill: SkillKey, stage: string) {
  if (skill === "pronunciation") {
    if (stage === "C2") return "Read this aloud with natural stage-like delivery and clear articulation: 'Innovation grows when curious students ask bold questions and test new ideas.'";
    if (stage === "C1") return "Read this aloud clearly with natural stress: 'Leaders create impact by combining evidence, empathy, and action.'";
    if (stage === "B2") return "Read this aloud clearly: 'Team projects help us solve complex problems by sharing ideas.'";
    if (stage === "B1") return "Read this aloud clearly: 'I like learning new things with my friends at school.'";
    return "Read this aloud clearly: 'I learn English every day at school.'";
  }
  if (skill === "vocabulary") {
    if (stage === "C2") return "Use these words naturally in one short speech: perspective, evidence, challenge, outcome.";
    if (stage === "C1") return "Use these words in context: strategy, influence, responsibility, progress.";
    if (stage === "B2") return "Use these words in your answer: solution, compare, reason, benefit.";
    if (stage === "B1") return "Use these words: learn, team, improve, goal.";
    return "Use these words: school, friend, learn.";
  }
  if (skill === "tempo_control") {
    if (stage === "C2") return "Speak for 60-90 seconds on a topic you know, keeping a calm and controlled pace.";
    if (stage === "C1") return "Explain a school challenge and solution with steady pace and clear pauses.";
    if (stage === "B2") return "Talk about a recent project clearly and avoid rushing.";
    if (stage === "B1") return "Talk about your weekly routine with smooth pace.";
    return "Talk about your morning routine slowly and clearly.";
  }
  if (skill === "task_completion") {
    if (stage === "C2") return "Answer: Should schools require community service? Give a clear position, reasons, and a short counterpoint.";
    if (stage === "C1") return "Answer: What makes a good leader in school? Give your point and one real example.";
    if (stage === "B2") return "Answer: Which is better for learning: group study or solo study? Give two reasons.";
    if (stage === "B1") return "Answer: Why is teamwork important in class? Give one reason and one example.";
    return "Answer: What do you do after school? Give 2-3 short sentences.";
  }
  if (stage === "C2") return "Give a short persuasive talk on a topic you care about, with one strong example.";
  if (stage === "C1") return "Give a clear opinion talk with one supporting example.";
  if (stage === "B2") return "Talk about a challenge you solved and what you learned.";
  if (stage === "B1") return "Tell us about yourself and your goals in 4-5 sentences.";
  return "Tell us about yourself in 2-3 short sentences.";
}

function difficultyForStage(stage: string) {
  return thetaFromStage(stage);
}

function discriminationForSkill(skill: SkillKey) {
  if (skill === "pronunciation") return 1.25;
  if (skill === "task_completion") return 1.15;
  if (skill === "fluency") return 1.1;
  return 1;
}

function expectedMinWords(stage: string) {
  if (stage === "A0") return 10;
  if (stage === "A1") return 14;
  if (stage === "A2") return 20;
  if (stage === "B1") return 28;
  if (stage === "B2") return 38;
  if (stage === "C1") return 50;
  return 62;
}

function gseTargetsForStage(stage: string) {
  const range = mapStageToGseRange(stage);
  return { min: range.min, max: range.max };
}

function skillsForPlacementSkill(skill: SkillKey) {
  if (skill === "vocabulary") return ["vocabulary", "speaking"];
  if (skill === "pronunciation") return ["speaking", "grammar"];
  if (skill === "tempo_control") return ["speaking"];
  if (skill === "task_completion") return ["speaking", "writing", "listening", "grammar"];
  return ["speaking", "listening"];
}

async function resolvePlacementTargets(params: { stage: string; skill: SkillKey; ageBand?: string | null }) {
  const audience = params.ageBand === "6-8" || params.ageBand === "9-11" || params.ageBand === "12-14" ? "YL" : "AL";
  const range = gseTargetsForStage(params.stage);
  const skillHints = skillsForPlacementSkill(params.skill);
  const preferred = await prisma.gseNode.findMany({
    where: {
      audience: { in: [audience, "AL", "AE"] },
      skill: { in: skillHints },
      gseCenter: { gte: range.min - 2, lte: range.max + 2 },
    },
    orderBy: [{ gseCenter: "asc" }, { updatedAt: "desc" }],
    select: { nodeId: true },
    take: 4,
  });
  if (preferred.length > 0) return preferred.map((row) => row.nodeId);
  const fallback = await prisma.gseNode.findMany({
    where: {
      gseCenter: { gte: range.min - 5, lte: range.max + 5 },
    },
    orderBy: [{ gseCenter: "asc" }],
    select: { nodeId: true },
    take: 4,
  });
  return fallback.map((row) => row.nodeId);
}

function buildDefaultItemBank() {
  const items: Array<Omit<PlacementItemView, "id">> = [];
  for (const stage of STAGES) {
    for (const skill of CORE_SKILLS) {
      const taskType = taskTypeForSkill(skill);
      const prompt = defaultPromptFor(skill, stage);
      items.push({
        skillKey: skill,
        stageBand: stage,
        taskType,
        prompt,
        hint: "Speak clearly and stay on task.",
        expectedMinWords: expectedMinWords(stage),
        assessmentMode: taskType === "read_aloud" ? "pa" : "stt",
        maxDurationSec: taskType === "read_aloud" ? 30 : stageIndex(stage) >= 4 ? 90 : 60,
        difficulty: difficultyForStage(stage),
        discrimination: discriminationForSkill(skill),
        gseTargets: [],
      });
    }
  }
  return items;
}

async function ensurePlacementItemBank() {
  const activeItems = await prisma.placementItem.findMany({
    where: { active: true },
    select: { id: true, stageBand: true, skillKey: true, ageBand: true, gseTargets: true },
  });
  const count = activeItems.length;
  if (count >= 25) return;
  const defaults = buildDefaultItemBank();
  const resolvedDefaults = await Promise.all(
    defaults.map(async (item) => ({
      ...item,
      gseTargets: await resolvePlacementTargets({
        stage: item.stageBand,
        skill: item.skillKey,
      }),
    }))
  );
  await prisma.placementItem.createMany({
    data: resolvedDefaults.map((item) => ({
      skillKey: item.skillKey,
      stageBand: item.stageBand,
      taskType: item.taskType,
      promptTemplate: item.prompt,
      hint: item.hint,
      expectedMinWords: item.expectedMinWords,
      assessmentMode: item.assessmentMode,
      maxDurationSec: item.maxDurationSec,
      gseTargets: item.gseTargets,
      difficulty: item.difficulty,
      discrimination: item.discrimination,
      ageBand: null,
      active: true,
    })),
  });
}

async function normalizePlacementTargets() {
  const items = await prisma.placementItem.findMany({
    where: { active: true },
    select: { id: true, stageBand: true, skillKey: true, ageBand: true, gseTargets: true },
  });
  for (const item of items) {
    const hasInvalidTargets =
      !item.gseTargets?.length || item.gseTargets.some((target) => target.startsWith("gse-range:"));
    if (!hasInvalidTargets) continue;
    const targets = await resolvePlacementTargets({
      stage: item.stageBand,
      skill: item.skillKey as SkillKey,
      ageBand: item.ageBand,
    });
    if (!targets.length) continue;
    await prisma.placementItem.update({
      where: { id: item.id },
      data: { gseTargets: targets },
    });
  }
}

function mapItem(row: {
  id: string;
  skillKey: string;
  stageBand: string;
  taskType: string;
  promptTemplate: string;
  hint: string | null;
  expectedMinWords: number;
  assessmentMode: string;
  maxDurationSec: number;
  difficulty: number;
  discrimination: number;
  gseTargets: string[];
}): PlacementItemView {
  return {
    id: row.id,
    skillKey: row.skillKey as SkillKey,
    stageBand: row.stageBand,
    taskType: row.taskType,
    prompt: row.promptTemplate,
    hint: row.hint || "Speak clearly and stay on task.",
    expectedMinWords: row.expectedMinWords,
    assessmentMode: row.assessmentMode === "pa" ? "pa" : "stt",
    maxDurationSec: row.maxDurationSec,
    difficulty: row.difficulty,
    discrimination: row.discrimination,
    gseTargets: row.gseTargets || [],
  };
}

function initialThetaForAge(ageBand: string | null | undefined) {
  if (ageBand === "6-8") return -1.25;
  if (ageBand === "9-11") return -0.85;
  if (ageBand === "12-14") return -0.35;
  return -0.8;
}

async function selectNextItem(params: {
  theta: number;
  askedItemIds: string[];
  ageBand: string;
  currentSkillCoverage: Set<string>;
}) {
  const candidateItems = await prisma.placementItem.findMany({
    where: {
      active: true,
      id: { notIn: params.askedItemIds.length ? params.askedItemIds : undefined },
      OR: [{ ageBand: null }, { ageBand: params.ageBand }],
    },
    take: 120,
    orderBy: [{ updatedAt: "desc" }],
  });
  if (candidateItems.length === 0) return { item: null as PlacementItemView | null, why: "No active placement items." };

  const scored = candidateItems.map((row) => {
    const info = itemInformation(params.theta, row.difficulty, row.discrimination);
    const skillBonus = params.currentSkillCoverage.has(row.skillKey) ? 0 : 0.12;
    return {
      row,
      information: info + skillBonus,
    };
  });
  scored.sort((a, b) => b.information - a.information);
  const top = scored[0];
  return {
    item: mapItem(top.row),
    why: `Selected highest-information item around current ability (info=${round(top.information, 4)}).`,
  };
}

function shouldStop(params: { questionCount: number; sigma: number }) {
  if (params.questionCount < MIN_QUESTIONS) return false;
  if (params.sigma <= SIGMA_STOP) return true;
  if (params.questionCount >= MAX_QUESTIONS) return true;
  return false;
}

async function computeSkillSnapshot(sessionId: string) {
  const rows = await prisma.placementResponse.findMany({
    where: { sessionId },
    include: { item: true },
    orderBy: { createdAt: "asc" },
  });
  const grouped = new Map<SkillKey, number[]>();
  for (const row of rows) {
    const skill = row.item.skillKey as SkillKey;
    const list = grouped.get(skill) || [];
    list.push(row.itemScore * 100);
    grouped.set(skill, list);
  }

  const snapshot: Record<SkillKey, number> = {
    pronunciation: 45,
    fluency: 45,
    tempo_control: 45,
    vocabulary: 45,
    task_completion: 45,
  };
  for (const skill of CORE_SKILLS) {
    const values = grouped.get(skill) || [];
    if (!values.length) continue;
    snapshot[skill] = round(values.reduce((s, v) => s + v, 0) / values.length, 2);
  }
  return snapshot;
}

async function applyCarryoverIfNeeded(params: {
  studentId: string;
  stage: string;
  confidence: number;
}) {
  if (stageIndex(params.stage) < CARRYOVER_MIN_STAGE_INDEX) {
    return { carryoverApplied: false, carryoverNodes: [] as string[] };
  }
  if (params.confidence < CARRYOVER_CONFIDENCE) {
    return { carryoverApplied: false, carryoverNodes: [] as string[] };
  }

  const nodes = await prisma.gseNode.findMany({
    where: {
      gseCenter: { lte: 42 },
      skill: { in: ["speaking", "vocabulary", "grammar", "listening", "writing"] },
    },
    select: { nodeId: true },
    orderBy: [{ gseCenter: "desc" }],
    take: 240,
  });
  const nodeIds = nodes.map((row) => row.nodeId);
  if (!nodeIds.length) {
    return { carryoverApplied: false, carryoverNodes: [] as string[] };
  }

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
      decayStateJson: { dominanceCarryover: true, sourceStage: params.stage },
      calculationVersion: "placement-carryover-v1",
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
      halfLifeDays: 24,
      reliability: "medium",
      lastEvidenceAt: now,
      decayStateJson: { dominanceCarryover: true, sourceStage: params.stage },
      calculationVersion: "placement-carryover-v1",
    },
  });
  return { carryoverApplied: true, carryoverNodes: nodeIds.slice(0, 40) };
}

export function computePlacementResult(responses: Record<string, PlacementAnswerInput>) {
  let theta = -0.85;
  let sigma = 1;
  const pseudoSnapshot: Record<SkillKey, number> = {
    pronunciation: 0,
    fluency: 0,
    tempo_control: 0,
    vocabulary: 0,
    task_completion: 0,
  };
  const countBySkill: Record<SkillKey, number> = {
    pronunciation: 0,
    fluency: 0,
    tempo_control: 0,
    vocabulary: 0,
    task_completion: 0,
  };
  const fallbackItems = buildDefaultItemBank().slice(0, 10);
  const byId = new Map(fallbackItems.map((item) => [item.skillKey, item]));

  for (const answer of Object.values(responses)) {
    const id = answer.itemId || answer.questionId || "";
    const fallbackSkill = id.includes("pron")
      ? "pronunciation"
      : id.includes("tempo")
      ? "tempo_control"
      : id.includes("vocab")
      ? "vocabulary"
      : id.includes("task")
      ? "task_completion"
      : "fluency";
    const item = byId.get(fallbackSkill) || fallbackItems[0];
    const score = scorePlacementAnswer(
      {
        ...item,
        id: id || "fallback",
        skillKey: fallbackSkill as SkillKey,
      },
      answer
    );
    const itemScore = clamp(score / 100, 0, 1);
    const estimate = updateAbility({
      theta,
      sigma,
      itemDifficulty: item.difficulty,
      itemDiscrimination: item.discrimination,
      itemScore,
    });
    theta = estimate.theta;
    sigma = estimate.sigma;
    const skill = fallbackSkill as SkillKey;
    pseudoSnapshot[skill] += score;
    countBySkill[skill] += 1;
  }

  for (const skill of CORE_SKILLS) {
    pseudoSnapshot[skill] =
      countBySkill[skill] > 0 ? round(pseudoSnapshot[skill] / countBySkill[skill], 2) : 45;
  }
  const coverage = Object.values(countBySkill).filter((v) => v > 0).length / CORE_SKILLS.length;
  const confidence = confidenceFromSigma({ sigma, skillCoverage: coverage });
  const stage = stageFromTheta(theta);
  const average = round(clamp(((theta + 3) / 6) * 100, 0, 100), 2);
  return { stage, average, confidence, theta, sigma, skillSnapshot: pseudoSnapshot };
}

export function getPlacementQuestions() {
  return buildDefaultItemBank()
    .filter((item) => item.stageBand === "A1")
    .slice(0, 5)
    .map((item, index) => ({
      id: `q${index + 1}`,
      skillKey: item.skillKey,
      taskType: item.taskType,
      prompt: item.prompt,
      hint: item.hint,
      expectedMinWords: item.expectedMinWords,
      assessmentMode: item.assessmentMode,
      maxDurationSec: item.maxDurationSec,
      difficulty: item.difficulty,
      discrimination: item.discrimination,
      gseTargets: item.gseTargets,
      stageBand: item.stageBand,
    }));
}

export async function startPlacement(studentId: string) {
  await ensurePlacementItemBank();
  await normalizePlacementTargets();
  const profile = await prisma.learnerProfile.findUnique({ where: { studentId } });
  const ageBand = profile?.ageBand || "9-11";

  const existing = await prisma.placementSession.findFirst({
    where: { studentId, status: "started" },
    include: { currentItem: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (!existing.currentItemId) {
      const next = await selectNextItem({
        theta: existing.theta,
        askedItemIds: existing.askedItemIds,
        ageBand,
        currentSkillCoverage: new Set<string>(),
      });
      if (next.item) {
        return prisma.placementSession.update({
          where: { id: existing.id },
          data: {
            currentItemId: next.item.id,
          },
          include: { currentItem: true },
        });
      }
    }
    return existing;
  }

  const theta0 = initialThetaForAge(ageBand);
  const next = await selectNextItem({
    theta: theta0,
    askedItemIds: [],
    ageBand,
    currentSkillCoverage: new Set<string>(),
  });

  return prisma.placementSession.create({
    data: {
      studentId,
      status: "started",
      currentIndex: 0,
      questionCount: 0,
      theta: theta0,
      sigma: 1,
      askedItemIds: [],
      currentItemId: next.item?.id || null,
      stageEstimate: stageFromTheta(theta0),
      confidenceEstimate: confidenceFromSigma({ sigma: 1, skillCoverage: 0 }),
      responsesJson: {},
    },
    include: { currentItem: true },
  });
}

export async function submitPlacementAnswer(sessionId: string, answer: PlacementAnswerInput) {
  const session = await prisma.placementSession.findUnique({
    where: { id: sessionId },
    include: {
      currentItem: true,
      responses: { include: { item: true }, orderBy: { createdAt: "asc" } },
      student: { include: { profile: true } },
    },
  });
  if (!session) throw new Error("Placement session not found");
  if (session.status !== "started") throw new Error("Placement session is not active");

  const itemId = answer.itemId || answer.questionId || session.currentItemId;
  if (!itemId) throw new Error("Placement item is missing");
  const itemRow =
    session.currentItem && session.currentItem.id === itemId
      ? session.currentItem
      : await prisma.placementItem.findUnique({ where: { id: itemId } });
  if (!itemRow) throw new Error("Placement item not found");
  const item = mapItem(itemRow);
  const scorePercent = scorePlacementAnswer(item, answer);
  const itemScore = clamp(scorePercent / 100, 0, 1);

  const estimate = updateAbility({
    theta: session.theta,
    sigma: session.sigma,
    itemDifficulty: item.difficulty,
    itemDiscrimination: item.discrimination,
    itemScore,
  });

  const asked = Array.from(new Set([...(session.askedItemIds || []), item.id]));
  const nextQuestionCount = session.questionCount + 1;
  const skillCoverage = new Set([
    ...session.responses.map((r) => r.item.skillKey),
    item.skillKey,
  ]).size / CORE_SKILLS.length;
  const confidenceEstimate = confidenceFromSigma({
    sigma: estimate.sigma,
    skillCoverage,
  });
  const done = shouldStop({ questionCount: nextQuestionCount, sigma: estimate.sigma });
  const nextItem = done
    ? null
    : await selectNextItem({
        theta: estimate.theta,
        askedItemIds: asked,
        ageBand: session.student.profile?.ageBand || "9-11",
        currentSkillCoverage: new Set([...session.responses.map((r) => r.item.skillKey), item.skillKey]),
      });

  const responsesJson = {
    ...((session.responsesJson || {}) as Record<string, unknown>),
    [item.id]: {
      itemId: item.id,
      attemptId: answer.attemptId || null,
      itemScore,
      scorePercent,
      observedMetrics: answer.observedMetrics || null,
    },
  };

  await prisma.placementResponse.create({
    data: {
      sessionId: session.id,
      itemId: item.id,
      attemptId: answer.attemptId || null,
      itemScore,
      observedMetricsJson: (answer.observedMetrics || null) as Prisma.InputJsonValue,
      thetaBefore: session.theta,
      thetaAfter: estimate.theta,
      sigmaAfter: estimate.sigma,
    },
  });

  const updated = await prisma.placementSession.update({
    where: { id: session.id },
    data: {
      currentIndex: session.currentIndex + 1,
      questionCount: nextQuestionCount,
      theta: estimate.theta,
      sigma: estimate.sigma,
      askedItemIds: asked,
      currentItemId: nextItem?.item?.id || null,
      stageEstimate: stageFromTheta(estimate.theta),
      confidenceEstimate,
      responsesJson: responsesJson as Prisma.InputJsonValue,
    },
    include: { currentItem: true },
  });

  return {
    ...updated,
    done,
    nextItem: nextItem?.item || null,
    whyThisItem: nextItem?.why || null,
  };
}

export async function finishPlacement(sessionId: string) {
  const session = await prisma.placementSession.findUnique({
    where: { id: sessionId },
    include: { student: { include: { profile: true } } },
  });
  if (!session) throw new Error("Placement session not found");

  if (session.status === "completed" && session.resultJson) {
    return session.resultJson as {
      stage: string;
      provisionalStage: string;
      promotionStage: string;
      average: number;
      confidence: number;
      uncertainty: number;
      theta: number;
      sigma: number;
      skillSnapshot: Record<string, number>;
      carryoverApplied: boolean;
      carryoverNodes: string[];
      uncertainNodes: string[];
      promotionReady: boolean;
      blockedBundles: Array<{
        bundleKey: string;
        title: string;
        domain: string;
        reason: string;
      }>;
      coverage: number | null;
      reliability: number | null;
    };
  }

  if (session.questionCount < 1) throw new Error("Placement has no responses yet");

  const skillSnapshot = await computeSkillSnapshot(session.id);
  const uncertainRows = await prisma.placementResponse.findMany({
    where: { sessionId: session.id, itemScore: { gte: 0.35, lte: 0.7 } },
    include: { item: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const uncertainNodes = Array.from(
    new Set(uncertainRows.flatMap((row) => row.item.gseTargets || []))
  ).slice(0, 12);
  const beforeProjection = await projectLearnerStageFromGse(session.studentId);
  const carryover = await applyCarryoverIfNeeded({
    studentId: session.studentId,
    stage: beforeProjection.promotionStage,
    confidence: beforeProjection.placementConfidence,
  });
  const stageProjection = await refreshLearnerProfileFromGse({
    studentId: session.studentId,
    reason: "placement_finish",
    placementFresh: true,
    uncertainNodeIds: uncertainNodes,
    carryoverSummary: {
      carryoverApplied: carryover.carryoverApplied,
      carryoverNodes: carryover.carryoverNodes.slice(0, 30),
    },
  });
  await prisma.learnerProfile.update({
    where: { studentId: session.studentId },
    data: {
      placementCompletedAt: new Date(),
      cycleWeek: 1,
    },
  });

  await prisma.promotionAudit.create({
    data: {
      studentId: session.studentId,
      fromStage: session.student.profile?.stage || "A0",
      targetStage: stageProjection.promotionStage,
      promoted:
        stageIndex(stageProjection.promotionStage) > stageIndex(session.student.profile?.stage || "A0"),
      blockedByNodes: stageProjection.blockedByNodes,
      reasonsJson: {
        placement: true,
        source: "gse_only",
        theta: session.theta,
        sigma: session.sigma,
        confidence: stageProjection.placementConfidence,
        placementStage: stageProjection.placementStage,
        promotionStage: stageProjection.promotionStage,
        currentStageStats: stageProjection.currentStageStats,
        targetStageStats: stageProjection.targetStageStats,
        carryoverApplied: carryover.carryoverApplied,
      },
      readinessScore: stageProjection.score,
    },
  });

  const result = {
    stage: stageProjection.promotionStage,
    provisionalStage: stageProjection.placementStage,
    promotionStage: stageProjection.promotionStage,
    average: stageProjection.score,
    confidence: stageProjection.placementConfidence,
    uncertainty: stageProjection.placementUncertainty,
    theta: session.theta,
    sigma: session.sigma,
    skillSnapshot,
    carryoverApplied: carryover.carryoverApplied,
    carryoverNodes: carryover.carryoverNodes.slice(0, 40),
    uncertainNodes,
    promotionReady: stageProjection.promotionReady,
    blockedBundles: stageProjection.blockedBundles.map((item) => ({
      bundleKey: item.bundleKey,
      title: item.title,
      domain: item.domain,
      reason: item.reason,
    })),
    coverage:
      stageProjection.targetStageStats.coverage70 === null
        ? null
        : Number((stageProjection.targetStageStats.coverage70 * 100).toFixed(1)),
    reliability:
      stageProjection.targetStageStats.reliabilityRatio === null
        ? null
        : Number((stageProjection.targetStageStats.reliabilityRatio * 100).toFixed(1)),
  };

  await prisma.placementSession.update({
    where: { id: session.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      resultJson: result as Prisma.InputJsonValue,
    },
  });

  return result;
}

export async function getPlacementSession(studentId: string, sessionId: string) {
  const session = await prisma.placementSession.findUnique({
    where: { id: sessionId },
    include: { currentItem: true },
  });
  if (!session || session.studentId !== studentId) return null;
  return {
    session,
    question: session.currentItem ? mapItem(session.currentItem) : null,
    totalQuestions: MAX_QUESTIONS,
  };
}

// === Placement Extended Functions ===

type ScaffoldingLevel = "minimal" | "moderate" | "targeted";

async function analyzeLastAttemptNodes(attemptId: string): Promise<{
  stageDistribution: Record<string, number>;
  dominantStage: string;
  highestObservedStage: string;
  totalNodes: number;
}> {
  const evidence = await prisma.attemptGseEvidence.findMany({
    where: { attemptId, score: { gte: 0.5 } },
    include: { node: { select: { gseCenter: true } } },
  });

  const distribution: Record<string, number> = {};
  for (const row of evidence) {
    const stage = gseBandFromCenter(row.node.gseCenter);
    distribution[stage] = (distribution[stage] || 0) + 1;
  }

  if (evidence.length === 0) {
    return { stageDistribution: {}, dominantStage: "A1", highestObservedStage: "A1", totalNodes: 0 };
  }

  let dominantStage = "A1";
  let maxCount = 0;
  for (const [stage, count] of Object.entries(distribution)) {
    if (count > maxCount) {
      maxCount = count;
      dominantStage = stage;
    }
  }

  const observedStages = Object.keys(distribution);
  const highestObservedStage = observedStages.reduce((highest, stage) =>
    stageIndex(stage) > stageIndex(highest) ? stage : highest
  , "A0");

  return { stageDistribution: distribution, dominantStage, highestObservedStage, totalNodes: evidence.length };
}

function determineScaffoldingLevel(params: {
  attemptNumber: number;
  dominantStage: string;
  highestObservedStage: string;
  totalNodes: number;
  userFeedback?: "too_easy" | "just_right" | "too_hard";
}): ScaffoldingLevel {
  if (params.attemptNumber <= 2) return "minimal";

  if (params.userFeedback === "too_hard") return "minimal";
  if (params.userFeedback === "too_easy") return "targeted";

  if (params.totalNodes > 0 && stageIndex(params.highestObservedStage) > stageIndex(params.dominantStage)) {
    return "moderate";
  }

  return "minimal";
}

function determineTargetStage(params: {
  scaffoldingLevel: ScaffoldingLevel;
  dominantStage: string;
  highestObservedStage: string;
  projectedStage: CEFRStage;
  attemptNumber: number;
}): CEFRStage {
  if (params.attemptNumber <= 2) return params.projectedStage;

  if (params.scaffoldingLevel === "targeted") {
    const idx = Math.min(stageIndex(params.highestObservedStage) + 1, STAGES.length - 1);
    return STAGES[idx] as CEFRStage;
  }

  if (params.scaffoldingLevel === "moderate") {
    return params.highestObservedStage as CEFRStage;
  }

  return params.dominantStage as CEFRStage;
}

async function getScaffoldingVocab(stage: string, studentId: string): Promise<{
  nodeIds: string[];
  labels: string[];
  types: string[];
}> {
  const range = mapStageToGseRange(stage);
  const masteredIds = await prisma.studentGseMastery.findMany({
    where: { studentId, masteryScore: { gte: 70 } },
    select: { nodeId: true },
  });
  const masteredSet = new Set(masteredIds.map((r) => r.nodeId));

  const candidates = await prisma.gseNode.findMany({
    where: {
      type: "GSE_VOCAB",
      gseCenter: { gte: range.min, lte: range.max },
      audience: { in: ["YL", "AL", "AE"] },
    },
    select: { nodeId: true, descriptor: true, type: true },
    orderBy: { gseCenter: "asc" },
    take: 20,
  });

  const unmastered = candidates.filter((c) => !masteredSet.has(c.nodeId)).slice(0, 6);
  return {
    nodeIds: unmastered.map((n) => n.nodeId),
    labels: unmastered.map((n) => n.descriptor),
    types: unmastered.map((n) => n.type),
  };
}

async function generatePlacementExtendedTask(params: {
  studentId: string;
  session: { transcriptHistory: string[]; stageHistory: string[] };
  attemptNumber: number;
  scaffoldingLevel: ScaffoldingLevel;
  targetStage: CEFRStage;
}) {
  const scaffoldVocab = params.scaffoldingLevel !== "minimal"
    ? await getScaffoldingVocab(params.targetStage, params.studentId)
    : { nodeIds: [], labels: [], types: [] };

  const previousTranscript = params.session.transcriptHistory[params.session.transcriptHistory.length - 1];
  const previousContext = previousTranscript
    ? `Continue the conversation. Previous response: "${previousTranscript.slice(0, 400)}".`
    : "";

  const spec = await generateTaskSpec({
    taskType: "topic_talk",
    stage: params.targetStage,
    ageBand: "9-11",
    targetWords: [],
    targetNodeIds: scaffoldVocab.nodeIds,
    targetNodeLabels: scaffoldVocab.labels,
    targetNodeTypes: scaffoldVocab.types,
    focusSkills: ["fluency", "vocabulary", "grammar"],
    plannerReason: `Placement extended attempt ${params.attemptNumber}/6. Scaffolding: ${params.scaffoldingLevel}. ${previousContext}`,
    primaryGoal: params.scaffoldingLevel === "minimal"
      ? "Ask one wide open-ended question that can be answered at any level. Let the student show their natural ability."
      : `Ask a question that naturally uses ${params.targetStage}-level vocabulary. Model target words in your question.`,
    recentPrompts: params.session.transcriptHistory.slice(-2),
  });

  spec.maxDurationSec = 300;
  spec.constraints = { minSeconds: 60, maxSeconds: 360 };

  return { spec, scaffoldVocab };
}

async function shouldContinuePlacement(
  session: { questionCount: number; stageHistory: string[]; studentId: string }
): Promise<{ continue: boolean; reason: string }> {
  if (session.questionCount < 3) {
    return { continue: true, reason: "minimum_3_attempts_required" };
  }

  if (session.questionCount >= 6) {
    return { continue: false, reason: "maximum_6_attempts_reached" };
  }

  const projection = await projectLearnerStageFromGse(session.studentId);
  const uncertainty = projection.placementUncertainty;

  if (uncertainty <= 0.38) {
    return { continue: false, reason: `confident_estimate (uncertainty=${uncertainty.toFixed(3)})` };
  }

  const lastThreeStages = session.stageHistory.slice(-3);
  if (lastThreeStages.length === 3) {
    const allSame = lastThreeStages.every((s) => s === lastThreeStages[0]);
    if (allSame && session.questionCount >= 4) {
      return { continue: false, reason: `stage_converged_to_${lastThreeStages[0]}` };
    }
  }

  return { continue: true, reason: `uncertainty_too_high (${uncertainty.toFixed(3)} > 0.38)` };
}

export async function startPlacementExtended(studentId: string) {
  const existing = await prisma.placementSession.findFirst({
    where: { studentId, status: "started", placementMode: "placement_extended" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    const lastTask = await prisma.task.findFirst({
      where: { metaJson: { path: ["placementSessionId"], equals: existing.id } },
      orderBy: { createdAt: "desc" },
    });
    if (lastTask) {
      const meta = (lastTask.metaJson || {}) as Record<string, unknown>;
      if (typeof meta.maxDurationSec !== "number") {
        await prisma.task.update({
          where: { id: lastTask.id },
          data: { metaJson: { ...meta, maxDurationSec: 300 } },
        });
        lastTask.metaJson = { ...meta, maxDurationSec: 300 };
      }
      return { session: existing, task: lastTask };
    }
  }

  const session = await prisma.placementSession.create({
    data: {
      studentId,
      placementMode: "placement_extended",
      status: "started",
      questionCount: 0,
      theta: 0,
      sigma: 1,
      askedItemIds: [],
      transcriptHistory: [],
      stageHistory: [],
      conversationTheme: null,
    },
  });

  const projection = await projectLearnerStageFromGse(studentId);
  const initialStage = (projection.placementStage as CEFRStage) || "A2";

  const { spec, scaffoldVocab } = await generatePlacementExtendedTask({
    studentId,
    session: { transcriptHistory: [], stageHistory: [] },
    attemptNumber: 1,
    scaffoldingLevel: "minimal",
    targetStage: initialStage,
  });

  const task = await prisma.task.create({
    data: {
      type: spec.taskType,
      prompt: spec.prompt,
      level: 1,
      metaJson: {
        isPlacement: true,
        placementMode: "placement_extended",
        placementSessionId: session.id,
        placementAttemptNumber: 1,
        stage: initialStage,
        scaffoldingLevel: "minimal",
        maxDurationSec: 300,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  await assignTaskTargetsFromCatalog({
    taskId: task.id,
    stage: initialStage,
    taskType: spec.taskType,
    ageBand: "9-11",
    studentId,
    preferredNodeIds: scaffoldVocab.nodeIds.length > 0 ? scaffoldVocab.nodeIds : undefined,
  });

  return { session, task };
}

export async function submitPlacementExtendedAnswer(
  sessionId: string,
  attemptId: string,
  userFeedback?: "too_easy" | "just_right" | "too_hard"
) {
  const session = await prisma.placementSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const nodeAnalysis = await analyzeLastAttemptNodes(attemptId);

  const updatedSession = await prisma.placementSession.update({
    where: { id: sessionId },
    data: {
      questionCount: session.questionCount + 1,
      stageHistory: [...session.stageHistory, nodeAnalysis.dominantStage],
    },
  });

  const { continue: shouldContinue, reason } = await shouldContinuePlacement(updatedSession);

  if (!shouldContinue) {
    await prisma.placementSession.update({
      where: { id: sessionId },
      data: { status: "completed", completedAt: new Date() },
    });
    return { finished: true, reason };
  }

  const projection = await projectLearnerStageFromGse(session.studentId);
  const projectedStage = (projection.placementStage as CEFRStage) || "A2";

  const scaffoldingLevel = determineScaffoldingLevel({
    attemptNumber: updatedSession.questionCount + 1,
    dominantStage: nodeAnalysis.dominantStage,
    highestObservedStage: nodeAnalysis.highestObservedStage,
    totalNodes: nodeAnalysis.totalNodes,
    userFeedback,
  });

  const targetStage = determineTargetStage({
    scaffoldingLevel,
    dominantStage: nodeAnalysis.dominantStage,
    highestObservedStage: nodeAnalysis.highestObservedStage,
    projectedStage,
    attemptNumber: updatedSession.questionCount + 1,
  });

  const { spec, scaffoldVocab } = await generatePlacementExtendedTask({
    studentId: session.studentId,
    session: {
      transcriptHistory: updatedSession.transcriptHistory,
      stageHistory: updatedSession.stageHistory,
    },
    attemptNumber: updatedSession.questionCount + 1,
    scaffoldingLevel,
    targetStage,
  });

  const task = await prisma.task.create({
    data: {
      type: spec.taskType,
      prompt: spec.prompt,
      level: 1,
      metaJson: {
        isPlacement: true,
        placementMode: "placement_extended",
        placementSessionId: sessionId,
        placementAttemptNumber: updatedSession.questionCount + 1,
        stage: targetStage,
        scaffoldingLevel,
        maxDurationSec: 300,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  await assignTaskTargetsFromCatalog({
    taskId: task.id,
    stage: targetStage,
    taskType: spec.taskType,
    ageBand: "9-11",
    studentId: session.studentId,
    preferredNodeIds: scaffoldVocab.nodeIds.length > 0 ? scaffoldVocab.nodeIds : undefined,
  });

  return { finished: false, nextTask: task };
}
