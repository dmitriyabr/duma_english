import { prisma } from "./db";

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

  return {
    stage: profile?.stage || "A0",
    ageBand: profile?.ageBand || "9-11",
    cycleWeek: profile?.cycleWeek || 1,
    recentAttempts,
    streak,
    skills,
    focus,
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
