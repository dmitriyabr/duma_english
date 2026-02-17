import { oodAxisTags, oodTaskSpecContractSchema, type OODTaskSpecContract } from "@/lib/db/types";

const OOD_GENERATOR_VERSION = "ood-generator-v1";
const OOD_INJECTION_INTERVAL = 6; // ~16.7% default OOD frequency until CH-16 budget controller
const TASK_TYPE_PRIMARY_AXIS: Record<string, (typeof oodAxisTags)[number]> = {
  read_aloud: "format",
  target_vocab: "topic",
  qa_prompt: "interlocutor",
  role_play: "goal",
  topic_talk: "register",
  filler_control: "format",
  speech_builder: "goal",
};

function hashToPositiveInt(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickSecondaryAxis(primaryAxis: (typeof oodAxisTags)[number], seed: string) {
  const candidates = oodAxisTags.filter((axis) => axis !== primaryAxis);
  if (candidates.length === 0) return primaryAxis;
  const idx = hashToPositiveInt(seed) % candidates.length;
  return candidates[idx];
}

export function shouldInjectOodTask(taskOrdinal: number) {
  return taskOrdinal > 0 && taskOrdinal % OOD_INJECTION_INTERVAL === 0;
}

export function buildOodTaskSpecCandidate(params: {
  studentId: string;
  taskType: string;
  taskOrdinal: number;
  decisionLogId: string;
  estimatedDifficulty?: number | null;
}) {
  if (!shouldInjectOodTask(params.taskOrdinal)) return null;

  const primaryAxis =
    TASK_TYPE_PRIMARY_AXIS[params.taskType] ||
    oodAxisTags[hashToPositiveInt(`${params.taskType}:${params.studentId}`) % oodAxisTags.length];
  const secondaryAxis = pickSecondaryAxis(primaryAxis, `${params.decisionLogId}:${params.taskOrdinal}`);
  const axisTags =
    params.taskType === "topic_talk" || params.taskType === "role_play"
      ? [primaryAxis, secondaryAxis]
      : [primaryAxis];

  const difficulty = typeof params.estimatedDifficulty === "number" ? params.estimatedDifficulty : null;
  const payload = oodTaskSpecContractSchema.parse({
    studentId: params.studentId,
    decisionLogId: params.decisionLogId,
    axisTags,
    difficultyAnchor: difficulty ?? undefined,
    inDomainDifficulty: difficulty ?? undefined,
    difficultyDelta: 0,
    status: "planned",
    metadata: {
      generatorVersion: OOD_GENERATOR_VERSION,
      source: "task_next",
      taskOrdinal: params.taskOrdinal,
      interval: OOD_INJECTION_INTERVAL,
      taskType: params.taskType,
    },
  });

  return payload;
}

export function buildOodTaskSpecMetadataJson(candidate: OODTaskSpecContract) {
  return {
    ...(candidate.metadata || {}),
    axisTags: candidate.axisTags,
  };
}
