import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";
import { ensureLearnerProfile } from "@/lib/adaptive";
import { getStudentProgress } from "@/lib/progress";
import { computeStageBundleReadiness } from "@/lib/gse/bundles";
import { mapStageToGseRange } from "@/lib/gse/utils";

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function ensureTeacherCanAccessStudent(
  teacherId: string,
  studentId: string
) {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    include: {
      class: { select: { id: true, name: true, teacherId: true } },
    },
  });
  if (!student || student.class.teacherId !== teacherId) return null;
  return student;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { studentId } = await params;
  const student = await ensureTeacherCanAccessStudent(
    teacher.teacherId,
    studentId
  );
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  await ensureLearnerProfile(studentId);
  const progress = await getStudentProgress(studentId);
  const recentAttemptsLimit = parseBoundedInt(
    req.nextUrl.searchParams.get("recentAttemptsLimit"),
    20,
    1,
    100
  );
  const masteryLimit = parseBoundedInt(
    req.nextUrl.searchParams.get("masteryLimit"),
    400,
    50,
    1000
  );
  const outcomesLimit = parseBoundedInt(
    req.nextUrl.searchParams.get("outcomesLimit"),
    15,
    1,
    100
  );

  const [recentAttempts, fullMasteryRows, attemptsWithOutcomes, activeLessonSession, latestLessonSession] = await Promise.all([
    prisma.attempt.findMany({
      where: { studentId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: recentAttemptsLimit,
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
        scoresJson: true,
        task: {
          select: { type: true, prompt: true },
        },
      },
    }),
    prisma.studentGseMastery.findMany({
      where: { studentId },
      include: {
        node: {
          select: {
            nodeId: true,
            descriptor: true,
            type: true,
            skill: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: masteryLimit,
    }),
    prisma.attempt.findMany({
      where: { studentId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: outcomesLimit,
      select: { id: true, createdAt: true, nodeOutcomesJson: true },
    }),
    prisma.lessonSession.findFirst({
      where: { studentId, status: "active" },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        steps: {
          orderBy: { ordinal: "asc" },
          select: {
            ordinal: true,
            stepType: true,
            status: true,
            source: true,
          },
        },
      },
    }),
    prisma.lessonSession.findFirst({
      where: { studentId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        startedAt: true,
        updatedAt: true,
        completedAt: true,
        missionJson: true,
        progressJson: true,
        steps: {
          orderBy: { ordinal: "asc" },
          select: {
            ordinal: true,
            stepType: true,
            status: true,
            source: true,
            score: true,
          },
        },
      },
    }),
  ]);

  const fullMastery = fullMasteryRows.map((m) => ({
    nodeId: m.nodeId,
    descriptor: m.node.descriptor,
    type: m.node.type,
    skill: m.node.skill,
    masteryScore: m.masteryScore,
    decayedMastery: m.decayedMastery ?? m.masteryMean ?? m.masteryScore,
    evidenceCount: m.evidenceCount,
    directEvidenceCount: m.directEvidenceCount,
    activationState: m.activationState,
    lastEvidenceAt: m.lastEvidenceAt,
    updatedAt: m.updatedAt,
    halfLifeDays: m.halfLifeDays,
    masterySigma: m.masterySigma,
  }));

  type NodeOutcome = {
    nodeId: string;
    deltaMastery: number;
    decayImpact: number;
    previousMean?: number;
    nextMean?: number;
    reliability?: string;
    evidenceCount?: number;
    streakMultiplier?: number;
  };
  const recentNodeOutcomes: Array<{
    descriptor: string;
    nodeId: string;
    stage: string;
    deltaMastery: number;
    decayImpact: number;
    previousMean?: number;
    nextMean?: number;
    attemptCreatedAt: string;
    streakMultiplier?: number;
  }> = [];
  const nodeIdsFromOutcomes = new Set<string>();
  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    for (const o of outcomes) nodeIdsFromOutcomes.add(o.nodeId);
  }
  function gseBandFromCenter(value: number | null | undefined): string {
    if (typeof value !== "number") return "A0";
    if (value <= 29) return "A1";
    if (value <= 42) return "A2";
    if (value <= 58) return "B1";
    if (value <= 75) return "B2";
    if (value <= 84) return "C1";
    return "C2";
  }

  const nodeIdToInfo =
    nodeIdsFromOutcomes.size > 0
      ? await prisma.gseNode
          .findMany({
            where: { nodeId: { in: Array.from(nodeIdsFromOutcomes) } },
            select: { nodeId: true, descriptor: true, gseCenter: true },
          })
          .then((rows) =>
            new Map(rows.map((r) => [r.nodeId, { descriptor: r.descriptor, stage: gseBandFromCenter(r.gseCenter) }]))
          )
      : new Map<string, { descriptor: string; stage: string }>();

  for (const a of attemptsWithOutcomes) {
    const outcomes = Array.isArray(a.nodeOutcomesJson) ? (a.nodeOutcomesJson as NodeOutcome[]) : [];
    const attemptDate = a.createdAt.toISOString();
    for (const o of outcomes) {
      const info = nodeIdToInfo.get(o.nodeId);
      recentNodeOutcomes.push({
        descriptor: info?.descriptor ?? o.nodeId,
        nodeId: o.nodeId,
        stage: info?.stage ?? "A0",
        deltaMastery: o.deltaMastery,
        decayImpact: o.decayImpact,
        previousMean: o.previousMean,
        nextMean: o.nextMean,
        attemptCreatedAt: attemptDate,
        ...(typeof o.streakMultiplier === "number" && { streakMultiplier: o.streakMultiplier }),
      });
    }
  }

  const STAGES = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
  type CEFRStageType = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  const placementStage = (progress as { placementStage?: string }).placementStage;
  const ds = (progress as {
    domainStages?: {
      speaking: { stage: string };
      listening: { stage: string };
      reading: { stage: string };
      writing: { stage: string };
      vocab: { stage: string };
      grammar: { stage: string };
      communication: { stage: string };
    };
  }).domainStages;
  const domainPlacementStages = ds ? {
    vocab: ds.vocab.stage as CEFRStageType,
    grammar: ds.grammar.stage as CEFRStageType,
    lo: ds.communication.stage as CEFRStageType,
  } : undefined;

  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);

  const [catalogNodesByBand, bundleReadiness, recentDecisionsRows, oodSummary] = await Promise.all([
    Promise.all(
      STAGES.map(async (stage) => {
        const range = mapStageToGseRange(stage);
        const count = await prisma.gseNode.count({
          where: { gseCenter: { gte: range.min, lte: range.max } },
        });
        return [stage, count] as const;
      })
    ).then((pairs) => Object.fromEntries(pairs)),
    computeStageBundleReadiness(studentId, placementStage as CEFRStageType | undefined, domainPlacementStages),
    prisma.plannerDecisionLog.findMany({
      where: { studentId },
      orderBy: { decisionTs: "desc" },
      take: 10,
      select: { decisionTs: true, chosenTaskType: true, selectionReason: true, targetNodeIds: true },
    }),
    prisma.oODTaskSpec.findMany({
      where: { studentId, createdAt: { gte: since30d }, taskInstanceId: { not: null } },
      select: { verdict: true },
    }),
  ]);

  const perStageCredited: Record<string, number> = {};
  const perStageBundleTotal: Record<string, number> = {};
  for (const row of bundleReadiness.stageRows) {
    perStageCredited[row.stage] = row.bundleRows.reduce((sum, b) => sum + b.coveredCount, 0);
    perStageBundleTotal[row.stage] = row.bundleRows.reduce((sum, b) => sum + b.totalRequired, 0);
  }

  // Per-domain promotion path: each domain targets domainStage + 1
  const STAGE_SEQ = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
  const domainStageMap: Record<string, string> = {
    vocab: ds?.vocab.stage ?? "A1",
    grammar: ds?.grammar.stage ?? "A1",
    lo: ds?.communication.stage ?? "A1",
  };

  const domainBundleBlockers: Record<string, Array<{ nodeId: string; descriptor: string; value: number }>> = {};
  const domainPromotionPath: Record<string, {
    currentStage: string;
    targetStage: string;
    title: string;
    coveredCount: number;
    totalRequired: number;
    ready: boolean;
    blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
    achieved: Array<{ nodeId: string; descriptor: string; value: number }>;
  }> = {};

  for (const domain of ["vocab", "grammar", "lo"]) {
    const current = domainStageMap[domain];
    const idx = STAGE_SEQ.indexOf(current as typeof STAGE_SEQ[number]);
    if (idx < 0 || idx >= STAGE_SEQ.length - 1) continue;
    const target = STAGE_SEQ[idx + 1];
    const row = bundleReadiness.rows.find((r) => r.stage === target && r.domain === domain);
    if (!row) continue;
    const blockers = row.blockers.sort((a, b) => a.value - b.value).slice(0, 8);
    domainBundleBlockers[domain] = blockers;
    domainPromotionPath[domain] = {
      currentStage: current,
      targetStage: target,
      title: row.title,
      coveredCount: row.coveredCount,
      totalRequired: row.totalRequired,
      ready: row.ready,
      blockers,
      achieved: row.achieved.slice(0, 8),
    };
  }

  const decisionNodeIds = new Set<string>();
  for (const d of recentDecisionsRows) {
    for (const id of d.targetNodeIds) decisionNodeIds.add(id);
  }
  const nodeIdToDescriptor =
    decisionNodeIds.size > 0
      ? await prisma.gseNode
          .findMany({
            where: { nodeId: { in: Array.from(decisionNodeIds) } },
            select: { nodeId: true, descriptor: true },
          })
          .then((rows) => new Map(rows.map((r) => [r.nodeId, r.descriptor])))
      : new Map<string, string>();

  const promotionReadiness = progress?.promotionReadiness;
  const blockedBundlesReadable = promotionReadiness?.blockedBundlesReadable ?? [];
  const blockerCauses = [...new Set(blockedBundlesReadable.map((b) => b.reasonLabel))].filter(Boolean);
  const retention = promotionReadiness?.retention as { blendedPassRate?: number | null; windows?: Array<{ windowDays: number; passRate?: number | null }> } | undefined;
  const retentionGate = promotionReadiness?.retentionGate as { passed?: boolean; required?: boolean } | undefined;
  const transferEvaluable = oodSummary.filter((o) => o.verdict && o.verdict !== "none").length;
  const transferPassCount = oodSummary.filter((o) => o.verdict === "transfer_pass").length;
  const transferPassRate = transferEvaluable > 0 ? Number((transferPassCount / transferEvaluable).toFixed(4)) : null;
  const retentionWindow7 = retention?.windows?.find((w) => w.windowDays === 7);
  const retentionWindow30 = retention?.windows?.find((w) => w.windowDays === 30);
  const etaScore = promotionReadiness?.readinessScore != null ? Math.round((promotionReadiness.readinessScore as number) * 100) : null;
  const blockerCount = promotionReadiness?.blockedByNodeDescriptors?.length ?? 0;
  const etaToNextMilestone =
    etaScore != null && blockerCount > 0
      ? `Readiness ${etaScore}%. ${blockerCount} node(s) to verify for next milestone.`
      : etaScore != null
        ? `Readiness ${etaScore}%.`
        : "Not enough data yet.";

  const copilot = {
    blockerCauses,
    transferRetentionHealth: {
      retentionGatePassed: retentionGate?.passed ?? null,
      retentionGateRequired: retentionGate?.required ?? null,
      retentionPassRate7d: retentionWindow7?.passRate ?? null,
      retentionPassRate30d: retentionWindow30?.passRate ?? null,
      transferPassRate,
      transferEvaluableCount: transferEvaluable,
    },
    etaToNextMilestone,
    recentDecisions: recentDecisionsRows.map((d) => ({
      createdAt: d.decisionTs.toISOString(),
      chosenTaskType: d.chosenTaskType,
      selectionReason: d.selectionReason,
      targetDescriptors: d.targetNodeIds.map((id) => nodeIdToDescriptor.get(id) ?? id).slice(0, 5),
    })),
  };

  const latestMission = latestLessonSession?.missionJson && typeof latestLessonSession.missionJson === "object"
    ? (latestLessonSession.missionJson as Record<string, unknown>)
    : {};
  const latestProgress = latestLessonSession?.progressJson && typeof latestLessonSession.progressJson === "object"
    ? (latestLessonSession.progressJson as Record<string, unknown>)
    : {};
  const transferPassed =
    latestProgress.transferPassed === true ||
    latestLessonSession?.steps.some((step) => step.stepType === "transfer" && step.status === "passed") ||
    false;
  const correctiveTriggered = typeof latestProgress.correctiveTriggered === "number"
    ? latestProgress.correctiveTriggered
    : latestLessonSession?.steps.filter((step) => step.source === "corrective").length || 0;
  const activeStep =
    activeLessonSession?.steps.find((step) => step.status === "active") ||
    activeLessonSession?.steps.find((step) => step.status === "pending") ||
    null;
  const staleMinutes = activeLessonSession
    ? Math.round((Date.now() - activeLessonSession.updatedAt.getTime()) / 60000)
    : 0;
  const liveStatus = !activeLessonSession
    ? latestLessonSession?.status === "completed"
      ? "completed"
      : "idle"
    : activeStep?.source === "corrective" || activeStep?.stepType === "drill"
    ? "retry_loop"
    : staleMinutes >= 8
    ? "stuck"
    : "in_progress";

  return NextResponse.json({
    student: {
      id: student.id,
      displayName: student.displayName,
      createdAt: student.createdAt,
      classId: student.classId,
      className: student.class.name,
    },
    progress,
    catalogNodesByBand,
    perStageCredited,
    perStageBundleTotal,
    recentAttempts: recentAttempts.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
      scores: a.scoresJson,
      taskType: a.task.type,
      promptPreview: a.task.prompt?.slice(0, 120),
    })),
    fullMastery,
    recentNodeOutcomes: recentNodeOutcomes.slice(0, 80),
    lastLessonSummary: latestLessonSession
      ? {
          lessonSessionId: latestLessonSession.id,
          status: latestLessonSession.status,
          missionTitle:
            typeof latestMission.title === "string" ? latestMission.title : "Lesson mission",
          goal:
            typeof latestMission.goal === "string"
              ? latestMission.goal
              : "Practice and transfer in one lesson.",
          transferPassed,
          correctiveTriggered,
          coverageDebtAfter:
            latestProgress.coverageDebtAfter && typeof latestProgress.coverageDebtAfter === "object"
              ? latestProgress.coverageDebtAfter
              : null,
          updatedAt: latestLessonSession.updatedAt.toISOString(),
          completedAt: latestLessonSession.completedAt?.toISOString() || null,
        }
      : null,
    liveStatus: {
      status: liveStatus,
      lessonSessionId: activeLessonSession?.id || null,
      stepType: activeStep?.stepType || null,
      stepOrdinal: typeof activeStep?.ordinal === "number" ? activeStep.ordinal : null,
      blockerLabel:
        liveStatus === "stuck"
          ? `No progress for ${staleMinutes} min`
          : liveStatus === "retry_loop"
          ? "Fix-now loop"
          : null,
      updatedAt: activeLessonSession?.updatedAt.toISOString() || null,
    },
    domainBundleBlockers,
    domainPromotionPath,
    copilot,
    limits: {
      recentAttemptsLimit,
      masteryLimit,
      outcomesLimit,
    },
  });
}
