import { oodAxisTags } from "@/lib/db/types";

export const DIFFICULTY_CALIBRATION_VERSION = "difficulty-calibration-v1" as const;
export const SHARED_SCALE_MEAN = 50;
export const SHARED_SCALE_STD = 15;

export const OOD_TASK_FAMILIES = [
  "read_aloud",
  "target_vocab",
  "qa_prompt",
  "role_play",
  "topic_talk",
  "filler_control",
  "speech_builder",
  "argumentation",
  "register_switch",
  "misunderstanding_repair",
] as const;

export type OodTaskFamily = (typeof OOD_TASK_FAMILIES)[number];

export type DifficultyFamilyProfile = {
  taskType: OodTaskFamily;
  mean: number;
  std: number;
  sampleSize: number;
};

export type DifficultyCalibrationSet = {
  version: typeof DIFFICULTY_CALIBRATION_VERSION;
  generatedAt: string;
  profiles: Record<OodTaskFamily, DifficultyFamilyProfile>;
};

export type DifficultyCalibrationRow = {
  taskType: string;
  estimatedDifficulty: number | null;
  createdAt: Date;
};

export type DifficultyAnchorStabilityReport = {
  generatedAt: string;
  calibrationVersion: typeof DIFFICULTY_CALIBRATION_VERSION;
  windowDays: number;
  totalSamples: number;
  sharedScaleStats: {
    mean: number | null;
    std: number | null;
    min: number | null;
    max: number | null;
  };
  profiles: Array<
    DifficultyFamilyProfile & {
      baselineMean: number;
      baselineStd: number;
      deltaFromBaselineMean: number;
      calibrationHealth: "stable" | "watch" | "unstable";
    }
  >;
  notes: string[];
};

type NumericArrayStats = {
  mean: number;
  std: number;
  min: number;
  max: number;
};

function round(value: number) {
  return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeStats(values: number[]): NumericArrayStats | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      : 0;
  const std = Math.sqrt(variance);
  return {
    mean: round(mean),
    std: round(Math.max(std, 0)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

export const BASELINE_DIFFICULTY_PROFILES: Record<OodTaskFamily, DifficultyFamilyProfile> = {
  read_aloud: { taskType: "read_aloud", mean: 42, std: 11, sampleSize: 0 },
  target_vocab: { taskType: "target_vocab", mean: 48, std: 12, sampleSize: 0 },
  qa_prompt: { taskType: "qa_prompt", mean: 50, std: 12, sampleSize: 0 },
  role_play: { taskType: "role_play", mean: 56, std: 13, sampleSize: 0 },
  topic_talk: { taskType: "topic_talk", mean: 58, std: 14, sampleSize: 0 },
  filler_control: { taskType: "filler_control", mean: 46, std: 10, sampleSize: 0 },
  speech_builder: { taskType: "speech_builder", mean: 54, std: 13, sampleSize: 0 },
  argumentation: { taskType: "argumentation", mean: 84, std: 10, sampleSize: 0 },
  register_switch: { taskType: "register_switch", mean: 86, std: 9, sampleSize: 0 },
  misunderstanding_repair: { taskType: "misunderstanding_repair", mean: 82, std: 10, sampleSize: 0 },
};

function isOodTaskFamily(taskType: string): taskType is OodTaskFamily {
  return (OOD_TASK_FAMILIES as readonly string[]).includes(taskType);
}

function safeStd(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function calibrateDifficultyToSharedScale(params: {
  taskType: string;
  estimatedDifficulty: number;
  calibrationSet?: DifficultyCalibrationSet;
}) {
  const taskType = isOodTaskFamily(params.taskType) ? params.taskType : "qa_prompt";
  const profiles = params.calibrationSet?.profiles || BASELINE_DIFFICULTY_PROFILES;
  const profile = profiles[taskType] || BASELINE_DIFFICULTY_PROFILES.qa_prompt;
  const z = (params.estimatedDifficulty - profile.mean) / safeStd(profile.std);
  const shared = clamp(SHARED_SCALE_MEAN + z * SHARED_SCALE_STD, 0, 100);
  return {
    taskType,
    rawDifficulty: round(params.estimatedDifficulty),
    profileMean: round(profile.mean),
    profileStd: round(profile.std),
    zScore: round(z),
    sharedScaleDifficulty: round(shared),
  };
}

export function buildDifficultyCalibrationSet(params: {
  rows: DifficultyCalibrationRow[];
  now?: Date;
}): DifficultyCalibrationSet {
  const rowsByType = new Map<OodTaskFamily, number[]>();
  for (const taskType of OOD_TASK_FAMILIES) rowsByType.set(taskType, []);

  for (const row of params.rows) {
    if (!isOodTaskFamily(row.taskType)) continue;
    if (typeof row.estimatedDifficulty !== "number" || !Number.isFinite(row.estimatedDifficulty)) continue;
    rowsByType.get(row.taskType)?.push(row.estimatedDifficulty);
  }

  const profiles = {} as Record<OodTaskFamily, DifficultyFamilyProfile>;
  for (const taskType of OOD_TASK_FAMILIES) {
    const samples = rowsByType.get(taskType) || [];
    const stats = computeStats(samples);
    const baseline = BASELINE_DIFFICULTY_PROFILES[taskType];
    profiles[taskType] = {
      taskType,
      mean: stats ? stats.mean : baseline.mean,
      std: stats ? Math.max(stats.std, 1) : baseline.std,
      sampleSize: samples.length,
    };
  }

  return {
    version: DIFFICULTY_CALIBRATION_VERSION,
    generatedAt: (params.now || new Date()).toISOString(),
    profiles,
  };
}

function classifyCalibrationHealth(deltaMean: number): "stable" | "watch" | "unstable" {
  if (deltaMean <= 4) return "stable";
  if (deltaMean <= 8) return "watch";
  return "unstable";
}

export function buildDifficultyAnchorStabilityReport(params: {
  rows: DifficultyCalibrationRow[];
  windowDays: number;
  now?: Date;
  baselineSet?: DifficultyCalibrationSet;
}) {
  const calibrationSet = buildDifficultyCalibrationSet({
    rows: params.rows,
    now: params.now,
  });
  const baselineProfiles = params.baselineSet?.profiles || BASELINE_DIFFICULTY_PROFILES;
  const sharedSamples: number[] = [];

  for (const row of params.rows) {
    if (!isOodTaskFamily(row.taskType)) continue;
    if (typeof row.estimatedDifficulty !== "number" || !Number.isFinite(row.estimatedDifficulty)) continue;
    const calibrated = calibrateDifficultyToSharedScale({
      taskType: row.taskType,
      estimatedDifficulty: row.estimatedDifficulty,
      calibrationSet,
    });
    sharedSamples.push(calibrated.sharedScaleDifficulty);
  }

  const sharedStats = computeStats(sharedSamples);
  const profiles = OOD_TASK_FAMILIES.map((taskType) => {
    const profile = calibrationSet.profiles[taskType];
    const baseline = baselineProfiles[taskType] || BASELINE_DIFFICULTY_PROFILES[taskType];
    const deltaMean = round(Math.abs(profile.mean - baseline.mean));
    return {
      ...profile,
      baselineMean: round(baseline.mean),
      baselineStd: round(baseline.std),
      deltaFromBaselineMean: deltaMean,
      calibrationHealth: classifyCalibrationHealth(deltaMean),
    };
  });

  const unstableCount = profiles.filter((row) => row.calibrationHealth === "unstable").length;
  const notes: string[] = [];
  if (params.rows.length === 0) {
    notes.push("No eligible TaskInstance difficulty samples in selected window; baseline profiles retained.");
  }
  if (unstableCount > 0) {
    notes.push(`${unstableCount} task families are unstable versus baseline mean (>8 points drift).`);
  }

  const report: DifficultyAnchorStabilityReport = {
    generatedAt: (params.now || new Date()).toISOString(),
    calibrationVersion: DIFFICULTY_CALIBRATION_VERSION,
    windowDays: params.windowDays,
    totalSamples: params.rows.length,
    sharedScaleStats: {
      mean: sharedStats ? sharedStats.mean : null,
      std: sharedStats ? sharedStats.std : null,
      min: sharedStats ? sharedStats.min : null,
      max: sharedStats ? sharedStats.max : null,
    },
    profiles,
    notes,
  };

  return {
    calibrationSet,
    report,
  };
}

export function buildDifficultyAnchorMetadata(params: {
  taskType: string;
  estimatedDifficulty: number;
  calibrationSet?: DifficultyCalibrationSet;
}) {
  const calibrated = calibrateDifficultyToSharedScale(params);
  return {
    calibrationVersion: DIFFICULTY_CALIBRATION_VERSION,
    taskType: calibrated.taskType,
    rawDifficulty: calibrated.rawDifficulty,
    sharedScaleDifficulty: calibrated.sharedScaleDifficulty,
    zScore: calibrated.zScore,
    profileMean: calibrated.profileMean,
    profileStd: calibrated.profileStd,
    supportedAxes: oodAxisTags,
  };
}
