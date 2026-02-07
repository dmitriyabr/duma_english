import { prisma } from "./db";
import { nextTargetNodesForStudent } from "./gse/planner";

type SkillTrend = {
  skillKey: string;
  current: number | null;
  delta7: number | null;
  delta28: number | null;
  trend: "up" | "down" | "flat" | "insufficient";
  reliability: "high" | "medium" | "low";
  sampleCount: number;
};

function avg(values: number[]) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Number((sum / values.length).toFixed(2));
}

function trendFromDelta(delta: number | null): SkillTrend["trend"] {
  if (delta === null) return "insufficient";
  if (delta > 2) return "up";
  if (delta < -2) return "down";
  return "flat";
}

function bestReliability(values: Array<"high" | "medium" | "low">): "high" | "medium" | "low" {
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  return "low";
}

function startOfDay(input: Date) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

function gseBandFromCenter(value: number | null | undefined) {
  if (typeof value !== "number") return "unknown";
  if (value <= 29) return "A1";
  if (value <= 42) return "A2";
  if (value <= 58) return "B1";
  if (value <= 75) return "B2";
  if (value <= 84) return "C1";
  return "C2";
}

function stageOrder(stage: string) {
  const order = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = order.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

function nextStage(stage: string) {
  const order = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = order.indexOf(stage);
  if (idx === -1 || idx >= order.length - 1) return stage;
  return order[idx + 1];
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

export async function getStudentProgress(studentId: string) {
  const profile = await prisma.learnerProfile.findUnique({ where: { studentId } });
  const masteryRows = await prisma.studentSkillMastery.findMany({
    where: { studentId },
    orderBy: { masteryScore: "asc" },
  });
  const attempts = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const streak = await computeStreak(studentId);
  const today = startOfDay(new Date());
  const from28 = new Date(today);
  from28.setDate(from28.getDate() - 28);
  const from7 = new Date(today);
  from7.setDate(from7.getDate() - 7);

  const skillRows = await prisma.studentSkillDaily.findMany({
    where: { studentId, date: { gte: from28 } },
    orderBy: [{ skillKey: "asc" }, { date: "asc" }],
  });

  const grouped = new Map<string, typeof skillRows>();
  for (const row of skillRows) {
    const list = grouped.get(row.skillKey) || [];
    list.push(row);
    grouped.set(row.skillKey, list);
  }

  const skills: SkillTrend[] = Array.from(grouped.entries()).map(([skillKey, rows]) => {
    const current = rows.length ? rows[rows.length - 1].value : null;
    const last7 = rows.filter((item) => item.date >= from7).map((item) => item.value);
    const prev7 = rows.filter((item) => item.date < from7).map((item) => item.value);
    const last28 = rows.map((item) => item.value);
    const prev28 = rows.length > 28 ? rows.slice(0, rows.length - 28).map((item) => item.value) : [];

    const delta7Base = avg(prev7);
    const delta28Base = avg(prev28);
    const delta7 = avg(last7) !== null && delta7Base !== null ? Number((avg(last7)! - delta7Base).toFixed(2)) : null;
    const delta28 =
      avg(last28) !== null && delta28Base !== null ? Number((avg(last28)! - delta28Base).toFixed(2)) : null;
    const sampleCount = rows.reduce((sum, row) => sum + row.sampleCount, 0);

    return {
      skillKey,
      current,
      delta7,
      delta28,
      trend: trendFromDelta(delta7),
      reliability: bestReliability(rows.map((row) => row.reliability as "high" | "medium" | "low")),
      sampleCount,
    };
  });

  const recentAttempts = attempts.map((attempt) => ({
    id: attempt.id,
    createdAt: attempt.createdAt,
    scores: attempt.scoresJson,
  }));

  const focus = skills
    .filter((skill) => skill.current !== null)
    .sort((a, b) => (a.current ?? 0) - (b.current ?? 0))[0]?.skillKey || null;

  const placementNeeded =
    !profile?.placementScore ||
    typeof profile.placementConfidence !== "number" ||
    profile.placementConfidence < 0.6;

  const gseMastery = await prisma.studentGseMastery.findMany({
    where: { studentId },
    include: {
      node: {
        select: { nodeId: true, descriptor: true, gseCenter: true, skill: true, type: true },
      },
    },
    orderBy: [{ masteryScore: "asc" }],
  });
  const masteredNodes = gseMastery.filter((row) => row.masteryScore >= 80).length;
  const inProgressNodes = gseMastery.filter(
    (row) => row.masteryScore >= 40 && row.masteryScore < 80
  ).length;
  const now = new Date();
  const last7Start = new Date(now);
  last7Start.setDate(last7Start.getDate() - 7);
  const prev7Start = new Date(now);
  prev7Start.setDate(prev7Start.getDate() - 14);
  const last28Start = new Date(now);
  last28Start.setDate(last28Start.getDate() - 28);
  const prev28Start = new Date(now);
  prev28Start.setDate(prev28Start.getDate() - 56);

  const [last7Evidence, prev7Evidence, last28Evidence, prev28Evidence] = await Promise.all([
    prisma.attemptGseEvidence.findMany({
      where: { studentId, createdAt: { gte: last7Start } },
      select: { nodeId: true },
    }),
    prisma.attemptGseEvidence.findMany({
      where: { studentId, createdAt: { gte: prev7Start, lt: last7Start } },
      select: { nodeId: true },
    }),
    prisma.attemptGseEvidence.findMany({
      where: { studentId, createdAt: { gte: last28Start } },
      select: { nodeId: true },
    }),
    prisma.attemptGseEvidence.findMany({
      where: { studentId, createdAt: { gte: prev28Start, lt: last28Start } },
      select: { nodeId: true },
    }),
  ]);
  const uniq = (rows: Array<{ nodeId: string }>) => new Set(rows.map((row) => row.nodeId)).size;
  const last7Coverage = uniq(last7Evidence);
  const prev7Coverage = uniq(prev7Evidence);
  const last28Coverage = uniq(last28Evidence);
  const prev28Coverage = uniq(prev28Evidence);
  const nextTargetNodes = await nextTargetNodesForStudent(studentId, 3);
  const byBand = gseMastery.reduce<Record<string, { mastered: number; total: number }>>((acc, row) => {
    const band = gseBandFromCenter(row.node.gseCenter);
    if (!acc[band]) acc[band] = { mastered: 0, total: 0 };
    acc[band].total += 1;
    const value = row.decayedMastery ?? row.masteryMean ?? row.masteryScore;
    if (value >= 75) acc[band].mastered += 1;
    return acc;
  }, {});
  const overdueNodes = gseMastery
    .map((row) => {
      const halfLife = row.halfLifeDays ?? (row.node.type === "GSE_VOCAB" ? 14 : row.node.type === "GSE_GRAMMAR" ? 21 : 10);
      const lastEvidenceAt = row.lastEvidenceAt || row.updatedAt;
      const days = (now.getTime() - lastEvidenceAt.getTime()) / (1000 * 60 * 60 * 24);
      return {
        nodeId: row.nodeId,
        descriptor: row.node.descriptor,
        daysSinceEvidence: Number(days.toFixed(1)),
        halfLifeDays: halfLife,
        decayedMastery: row.decayedMastery ?? row.masteryMean ?? row.masteryScore,
      };
    })
    .filter((row) => row.daysSinceEvidence > row.halfLifeDays)
    .sort((a, b) => b.daysSinceEvidence - a.daysSinceEvidence)
    .slice(0, 8);
  const uncertainNodes = gseMastery
    .filter((row) => (row.masterySigma ?? 24) >= 22)
    .sort((a, b) => (b.masterySigma ?? 24) - (a.masterySigma ?? 24))
    .slice(0, 8)
    .map((row) => ({
      nodeId: row.nodeId,
      descriptor: row.node.descriptor,
      sigma: row.masterySigma ?? 24,
      mastery: row.decayedMastery ?? row.masteryMean ?? row.masteryScore,
    }));
  const currentStage = profile?.stage || "A0";
  const targetStage = nextStage(currentStage);
  const targetRange = rangeForStage(targetStage);
  const targetRows = gseMastery.filter((row) => {
    const g = row.node.gseCenter;
    return typeof g === "number" && g >= targetRange.min && g <= targetRange.max;
  });
  const covered = targetRows.filter(
    (row) => (row.decayedMastery ?? row.masteryMean ?? row.masteryScore) >= 70
  ).length;
  const coverageRatio = targetRows.length > 0 ? covered / targetRows.length : 0;
  const keyReliabilityRows = masteryRows.filter((row) =>
    ["pronunciation", "fluency", "task_completion"].includes(row.skillKey)
  );
  const reliabilityGate = keyReliabilityRows.every((row) => row.reliability !== "low");
  const stabilityGate = skills.every((skill) => skill.delta7 === null || skill.delta7 >= -2.5);
  const readinessScore = Number(
    Math.min(100, Math.max(0, coverageRatio * 60 + (reliabilityGate ? 20 : 8) + (stabilityGate ? 20 : 8))).toFixed(1)
  );
  const blockedRows = targetRows
    .filter((row) => (row.decayedMastery ?? row.masteryMean ?? row.masteryScore) < 60)
    .slice(0, 6);
  const blockedByNodes = blockedRows.map((row) => row.nodeId);
  const blockedByNodeDescriptors = blockedRows.map((row) => row.node.descriptor);
  const promotionReadiness = {
    currentStage,
    targetStage,
    ready:
      stageOrder(targetStage) === stageOrder(currentStage) ||
      (coverageRatio >= 0.62 && reliabilityGate && stabilityGate),
    readinessScore,
    coverageRatio: Number((coverageRatio * 100).toFixed(1)),
    blockedByNodes,
    blockedByNodeDescriptors,
  };
  const weeklyFocusReason = overdueNodes.length > 0
    ? "Review overdue nodes to prevent forgetting."
    : uncertainNodes.length > 0
    ? "Collect more evidence on uncertain nodes."
    : focus
    ? `Improve ${focus} based on recent trend.`
    : "Build more attempts to estimate weakest skills.";

  return {
    stage: profile?.stage || "A0",
    ageBand: profile?.ageBand || "9-11",
    cycleWeek: profile?.cycleWeek || 1,
    placementConfidence: profile?.placementConfidence || null,
    placementFresh: Boolean(profile?.placementFresh),
    carryoverSummary: profile?.placementCarryoverJson || null,
    placementNeeded,
    recentAttempts,
    streak,
    skills,
    focus,
    nodeProgress: {
      masteredNodes,
      inProgressNodes,
      nextTargetNodes,
      delta7: last7Coverage - prev7Coverage,
      delta28: last28Coverage - prev28Coverage,
      coverage7: last7Coverage,
      coverage28: last28Coverage,
    },
    nodeCoverageByBand: byBand,
    overdueNodes,
    uncertainNodes,
    promotionReadiness,
    blockedByNodes,
    weeklyFocusReason,
    mastery: masteryRows.map((row) => ({
      skillKey: row.skillKey,
      masteryScore: row.masteryScore,
      reliability: row.reliability,
      evidenceCount: row.evidenceCount,
    })),
  };
}

async function computeStreak(studentId: string) {
  const days = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const uniqueDays = new Set(days.map((entry) => entry.createdAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (uniqueDays.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }

  return streak;
}
