import type { CoverageDebtView, LessonSessionView, LessonSummaryView } from "@/lib/contracts/lessonRuntime";

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function buildLessonSummary(params: {
  session: LessonSessionView;
  debtBefore: CoverageDebtView;
  debtAfter: CoverageDebtView;
}): LessonSummaryView {
  const totalSteps = params.session.steps.length || 1;
  const completedSteps = params.session.steps.filter((step) => step.status === "passed" || step.status === "skipped").length;
  const transferSteps = params.session.steps.filter((step) => step.stepType === "transfer");
  const correctiveSteps = params.session.steps.filter((step) => step.source === "corrective");
  const correctivePassed = correctiveSteps.filter((step) => step.status === "passed").length;

  const pronunciationFocus = Array.from(
    new Set(
      correctiveSteps
        .flatMap((step) => {
          const meta = step.meta || {};
          const issues = Array.isArray(meta.issues) ? meta.issues : [];
          return issues.map((row) => {
            if (!row || typeof row !== "object") return null;
            const issue = row as Record<string, unknown>;
            return typeof issue.label === "string" ? issue.label : null;
          });
        })
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(0, 4);

  const nextFocus = params.debtAfter.severeDescriptors.length > 0
    ? params.debtAfter.severeDescriptors.slice(0, 3)
    : params.session.steps
        .map((step) => step.task?.taskType || null)
        .filter((item): item is string => Boolean(item))
        .slice(-2);

  return {
    sessionId: params.session.id,
    status: params.session.status,
    missionTitle: typeof params.session.mission.title === "string" ? params.session.mission.title : "Lesson mission",
    goalCoverage: {
      completedSteps,
      totalSteps,
      ratio: clampRatio(completedSteps / totalSteps),
    },
    transfer: {
      required: transferSteps.length > 0,
      passed: transferSteps.length > 0 ? transferSteps.every((step) => step.status === "passed") : false,
    },
    corrective: {
      triggeredCount: correctiveSteps.length,
      resolvedCount: correctivePassed,
    },
    coverageDebt: {
      before: params.debtBefore,
      after: params.debtAfter,
    },
    pronunciationFocus,
    nextFocus,
    generatedAt: new Date().toISOString(),
  };
}
