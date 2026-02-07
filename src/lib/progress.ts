import { prisma } from "./db";
import { nextTargetNodesForStudent } from "./gse/planner";
import { projectLearnerStageFromGse } from "./gse/stageProjection";

type SkillTrend = {
  skillKey: string;
  current: number | null;
  delta7: number | null;
  delta28: number | null;
  trend: "up" | "down" | "flat" | "insufficient";
  reliability: "high" | "medium" | "low";
  sampleCount: number;
  source: "gse-derived";
};

function gseBandFromCenter(value: number | null | undefined) {
  if (typeof value !== "number") return "unknown";
  if (value <= 29) return "A1";
  if (value <= 42) return "A2";
  if (value <= 58) return "B1";
  if (value <= 75) return "B2";
  if (value <= 84) return "C1";
  return "C2";
}

function trendFromDelta(delta: number | null): SkillTrend["trend"] {
  if (delta === null) return "insufficient";
  if (delta > 2) return "up";
  if (delta < -2) return "down";
  return "flat";
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

export async function getStudentProgress(studentId: string) {
  const profile = await prisma.learnerProfile.findUnique({ where: { studentId } });
  const projection = await projectLearnerStageFromGse(studentId);
  const attempts = await prisma.attempt.findMany({
    where: { studentId, status: "completed" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const streak = await computeStreak(studentId);

  const gseMastery = await prisma.studentGseMastery.findMany({
    where: { studentId },
    include: {
      node: {
        select: {
          nodeId: true,
          descriptor: true,
          gseCenter: true,
          skill: true,
          type: true,
        },
      },
    },
    orderBy: [{ masteryScore: "asc" }],
  });

  const masteredNodes = gseMastery.filter((row) => {
    const value = row.decayedMastery ?? row.masteryMean ?? row.masteryScore;
    return value >= 80;
  }).length;
  const inProgressNodes = gseMastery.filter((row) => {
    const value = row.decayedMastery ?? row.masteryMean ?? row.masteryScore;
    return value >= 40 && value < 80;
  }).length;

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

  const overdueNodes = gseMastery
    .map((row) => {
      const halfLife =
        row.halfLifeDays ??
        (row.node.type === "GSE_VOCAB" ? 14 : row.node.type === "GSE_GRAMMAR" ? 21 : 10);
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

  const skills: SkillTrend[] = projection.derivedSkills.map((item) => ({
    skillKey: item.skillKey,
    current: item.current,
    delta7: null,
    delta28: null,
    trend: trendFromDelta(null),
    reliability: item.reliability,
    sampleCount: item.sampleCount,
    source: "gse-derived",
  }));

  const focus = skills
    .filter((skill) => skill.current !== null)
    .sort((a, b) => (a.current ?? 0) - (b.current ?? 0))[0]?.skillKey || null;

  const weeklyFocusReason =
    overdueNodes.length > 0
      ? "Review overdue nodes to prevent forgetting."
      : uncertainNodes.length > 0
      ? "Collect more evidence on uncertain nodes."
      : focus
      ? `Improve ${focus} from weakest GSE node cluster.`
      : "Build more attempts to estimate weakest nodes.";

  return {
    stage: projection.stage,
    ageBand: profile?.ageBand || "9-11",
    cycleWeek: profile?.cycleWeek || 1,
    placementConfidence: profile?.placementConfidence || projection.confidence,
    placementFresh: Boolean(profile?.placementFresh),
    carryoverSummary: profile?.placementCarryoverJson || null,
    placementNeeded: gseMastery.length < 8,
    recentAttempts: attempts.map((attempt) => ({
      id: attempt.id,
      createdAt: attempt.createdAt,
      scores: attempt.scoresJson,
    })),
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
    nodeCoverageByBand: projection.nodeCoverageByBand,
    overdueNodes,
    uncertainNodes,
    promotionReadiness: {
      currentStage: projection.stage,
      targetStage: projection.targetStage,
      ready: projection.promotionReady,
      readinessScore: projection.score,
      coverageRatio:
        projection.targetStageStats.coverage70 === null
          ? null
          : Number((projection.targetStageStats.coverage70 * 100).toFixed(1)),
      blockedByNodes: projection.blockedByNodes,
      blockedByNodeDescriptors: projection.blockedByNodeDescriptors,
    },
    blockedByNodes: projection.blockedByNodes,
    weeklyFocusReason,
    mastery: projection.derivedSkills.map((row) => ({
      skillKey: row.skillKey,
      masteryScore: row.current ?? 0,
      reliability: row.reliability,
      evidenceCount: row.sampleCount,
      source: "gse-derived",
    })),
    gseBands: gseMastery.reduce<Record<string, number>>((acc, row) => {
      const band = gseBandFromCenter(row.node.gseCenter);
      acc[band] = (acc[band] || 0) + 1;
      return acc;
    }, {}),
  };
}
