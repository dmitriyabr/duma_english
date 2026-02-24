import type { CoverageDebtView } from "@/lib/contracts/lessonRuntime";

const BASE_TASK_TYPES = ["qa_prompt", "role_play", "misunderstanding_repair"];

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clipWords(value: string, maxWords: number) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function firstSentence(value: string) {
  const parts = value
    .split(/[.!?]/)
    .map((part) => normalizeSpaces(part))
    .filter(Boolean);
  return parts[0] || "";
}

function actionFromPrompt(prompt: string | undefined) {
  if (!prompt) return null;
  let value = normalizeSpaces(prompt.replace(/\n/g, " "));
  value = value
    .replace(/^(role[\s-]?play)\s*:\s*/i, "")
    .replace(/^question\s*:\s*/i, "")
    .replace(/^read this aloud clearly:\s*/i, "")
    .replace(/^read the passage and answer in [^.!?]+[.!?]\s*/i, "")
    .replace(/^listen and answer in [^.!?]+[.!?]\s*/i, "")
    .replace(/^write [^.!?]+[.!?]\s*/i, "")
    .replace(/^talk about\s*/i, "")
    .replace(/^speak about\s*/i, "")
    .replace(/\b(Passage|Question|Audio):/gi, "")
    .replace(/^["']|["']$/g, "");

  const sentence = firstSentence(value);
  if (!sentence) return null;
  const normalized = clipWords(sentence, 14);
  if (!normalized) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function missionTitleFromAction(primaryAction: string | null) {
  if (!primaryAction) return "Mission time";
  const short = clipWords(primaryAction, 4);
  return `Mission: ${short}`;
}

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
  primaryPrompt?: string;
  transferPrompt?: string;
}) {
  const primaryAction = actionFromPrompt(params.primaryPrompt);
  const transferAction = actionFromPrompt(params.transferPrompt);
  const focusLine =
    primaryAction ||
    (params.coverageDebt.severeDescriptors.length > 0
      ? params.coverageDebt.severeDescriptors[0]
      : "clear speech and smart answers");

  const goalParts = [
    `Scene 1: ${primaryAction || "Play the first scene."}`,
    params.coverageDebt.total > 0 ? "If one line is hard, retry and win." : null,
    `Scene 2: ${transferAction || "Use the same skill in a new place."}`,
  ].filter(Boolean);

  return {
    title: missionTitleFromAction(primaryAction),
    stage: params.stage,
    goal: goalParts.join(" "),
    primaryTaskType: params.primaryTaskType,
    focusLine,
    requiredTurns: requiredTurnsForTask(params.primaryTaskType),
    requiresTransferPass: true,
  };
}
