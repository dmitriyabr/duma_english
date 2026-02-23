import type { CoverageDebtView } from "@/lib/contracts/lessonRuntime";

const BASE_TASK_TYPES = ["qa_prompt", "role_play", "misunderstanding_repair"];

export function requiredTurnsForTask(taskType: string) {
  if (taskType === "qa_prompt" || taskType === "role_play" || taskType === "misunderstanding_repair") {
    return 5;
  }
  return 3;
}

export function pickPrimaryTaskType(stage: string) {
  const allowRepair = stage === "C1" || stage === "C2";
  const taskTypes = allowRepair ? BASE_TASK_TYPES : BASE_TASK_TYPES.filter((type) => type !== "misunderstanding_repair");
  const day = new Date().getUTCDate();
  return taskTypes[day % taskTypes.length] || "qa_prompt";
}

export function buildLessonMissionSeed(params: {
  stage: string;
  coverageDebt: CoverageDebtView;
  primaryTaskType: string;
}) {
  const focusLine =
    params.coverageDebt.severeDescriptors.length > 0
      ? params.coverageDebt.severeDescriptors[0]
      : "confidence and clear responses";

  const goal =
    params.coverageDebt.total > 0
      ? "Fix your top gap now, then use it in a new context."
      : "Do a strong dialogue and prove transfer in a new context.";

  return {
    title: "Lesson mission",
    stage: params.stage,
    goal,
    primaryTaskType: params.primaryTaskType,
    focusLine,
    requiredTurns: requiredTurnsForTask(params.primaryTaskType),
    requiresTransferPass: true,
  };
}
