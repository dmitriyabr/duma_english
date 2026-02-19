import { oodAxisTags, oodTaskSpecContractSchema, type OODTaskSpecContract } from "@/lib/db/types";
import { buildDifficultyAnchorMetadata } from "@/lib/ood/difficultyCalibration";
import { type OodBudgetDecision } from "@/lib/ood/budgetController";

const OOD_GENERATOR_VERSION = "ood-generator-v1";
const LEGACY_OOD_INJECTION_INTERVAL = 6; // backward-compatible fallback when no budget decision is available
const TASK_TYPE_PRIMARY_AXIS: Record<string, (typeof oodAxisTags)[number]> = {
  read_aloud: "format",
  target_vocab: "topic",
  qa_prompt: "interlocutor",
  role_play: "goal",
  topic_talk: "register",
  filler_control: "format",
  speech_builder: "goal",
  argumentation: "goal",
  register_switch: "register",
  misunderstanding_repair: "interlocutor",
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
  return shouldInjectOodTaskWithInterval(taskOrdinal, LEGACY_OOD_INJECTION_INTERVAL);
}

export function shouldInjectOodTaskWithInterval(taskOrdinal: number, interval: number) {
  const safeInterval = Math.max(1, Math.round(interval));
  return taskOrdinal > 0 && taskOrdinal % safeInterval === 0;
}

export function buildOodTaskSpecCandidate(params: {
  studentId: string;
  taskType: string;
  taskOrdinal: number;
  decisionLogId: string;
  estimatedDifficulty?: number | null;
  budgetDecision?: OodBudgetDecision;
}) {
  const injectionInterval = params.budgetDecision?.interval || LEGACY_OOD_INJECTION_INTERVAL;
  if (!shouldInjectOodTaskWithInterval(params.taskOrdinal, injectionInterval)) return null;

  const primaryAxis =
    TASK_TYPE_PRIMARY_AXIS[params.taskType] ||
    oodAxisTags[hashToPositiveInt(`${params.taskType}:${params.studentId}`) % oodAxisTags.length];
  const secondaryAxis = pickSecondaryAxis(primaryAxis, `${params.decisionLogId}:${params.taskOrdinal}`);
  const axisTags =
    params.taskType === "topic_talk" || params.taskType === "role_play"
      ? [primaryAxis, secondaryAxis]
      : [primaryAxis];

  const difficulty = typeof params.estimatedDifficulty === "number" ? params.estimatedDifficulty : null;
  const difficultyMetadata =
    difficulty !== null
      ? buildDifficultyAnchorMetadata({
          taskType: params.taskType,
          estimatedDifficulty: difficulty,
        })
      : null;
  const payload = oodTaskSpecContractSchema.parse({
    studentId: params.studentId,
    decisionLogId: params.decisionLogId,
    axisTags,
    difficultyAnchor: difficultyMetadata?.sharedScaleDifficulty,
    inDomainDifficulty: difficultyMetadata?.sharedScaleDifficulty,
    difficultyDelta: 0,
    status: "planned",
    metadata: {
      generatorVersion: OOD_GENERATOR_VERSION,
      source: "task_next",
      taskOrdinal: params.taskOrdinal,
      interval: injectionInterval,
      budgetController:
        params.budgetDecision || {
          controllerVersion: "legacy-fixed-interval-v1",
          budgetRate: Number((1 / injectionInterval).toFixed(4)),
          interval: injectionInterval,
          reasons: ["legacy_fixed_interval"],
        },
      taskType: params.taskType,
      difficultyCalibration: difficultyMetadata,
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
