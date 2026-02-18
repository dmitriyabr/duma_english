export const LOCALE_POLICY_CONTEXT_VERSION = "locale-policy-context-v1" as const;

export type LocalePrimaryTag = "english" | "swahili" | "sheng" | "home_language_hint" | "unknown";

export type LocaleSignalSample = {
  primaryTag: LocalePrimaryTag;
  primaryConfidence: number;
  codeSwitchDetected: boolean;
  homeLanguageHints: string[];
};

export type LocalePolicyProfile = {
  version: typeof LOCALE_POLICY_CONTEXT_VERSION;
  sampleCount: number;
  dominantPrimaryTag: LocalePrimaryTag;
  primaryTagShares: Record<LocalePrimaryTag, number>;
  codeSwitchRate: number;
  homeLanguageHintSet: string[];
  localizedCohort: boolean;
};

export type LocalePolicyAdaptation = {
  version: typeof LOCALE_POLICY_CONTEXT_VERSION;
  applied: boolean;
  overrideTaskType: string | null;
  reasonCodes: string[];
};

export type LocalePolicyContext = {
  profile: LocalePolicyProfile;
  adaptation: LocalePolicyAdaptation;
};

const TAGS: LocalePrimaryTag[] = ["english", "swahili", "sheng", "home_language_hint", "unknown"];

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTag(value: string | null): LocalePrimaryTag {
  if (
    value === "english" ||
    value === "swahili" ||
    value === "sheng" ||
    value === "home_language_hint" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export function extractLocaleSignalSample(taskEvaluationJson: unknown): LocaleSignalSample | null {
  const taskEvaluation = asObject(taskEvaluationJson);
  const artifacts = asObject(taskEvaluation.artifacts);
  const languageSignals = asObject(artifacts.languageSignals);
  if (Object.keys(languageSignals).length === 0) return null;

  const primaryTag = normalizeTag(asString(languageSignals.primaryTag));
  const primaryConfidence = Math.max(0, Math.min(1, asNumber(languageSignals.primaryConfidence) ?? 0));
  const codeSwitch = asObject(languageSignals.codeSwitch);
  const codeSwitchDetected = asBoolean(codeSwitch.detected) || false;
  const homeLanguageHints = Array.isArray(languageSignals.homeLanguageHints)
    ? Array.from(
        new Set(
          languageSignals.homeLanguageHints
            .map((item) => asString(asObject(item).language))
            .filter((value): value is string => Boolean(value))
        )
      )
    : [];

  return {
    primaryTag,
    primaryConfidence: round(primaryConfidence),
    codeSwitchDetected,
    homeLanguageHints,
  };
}

export function summarizeLocalePolicyProfile(samples: LocaleSignalSample[]): LocalePolicyProfile {
  const sampleCount = samples.length;
  const counts: Record<LocalePrimaryTag, number> = {
    english: 0,
    swahili: 0,
    sheng: 0,
    home_language_hint: 0,
    unknown: 0,
  };
  let codeSwitchCount = 0;
  const homeHintSet = new Set<string>();

  for (const sample of samples) {
    counts[sample.primaryTag] += 1;
    if (sample.codeSwitchDetected) codeSwitchCount += 1;
    for (const hint of sample.homeLanguageHints) {
      homeHintSet.add(hint);
    }
  }

  const denominator = Math.max(1, sampleCount);
  const primaryTagShares = {
    english: round(counts.english / denominator),
    swahili: round(counts.swahili / denominator),
    sheng: round(counts.sheng / denominator),
    home_language_hint: round(counts.home_language_hint / denominator),
    unknown: round(counts.unknown / denominator),
  };
  const dominantPrimaryTag = [...TAGS].sort((left, right) => counts[right] - counts[left])[0] || "unknown";
  const codeSwitchRate = round(codeSwitchCount / denominator);
  const hasLocalizationSignals =
    primaryTagShares.swahili >= 0.12 ||
    primaryTagShares.sheng >= 0.1 ||
    primaryTagShares.home_language_hint >= 0.08 ||
    codeSwitchRate >= 0.2 ||
    homeHintSet.size > 0;

  return {
    version: LOCALE_POLICY_CONTEXT_VERSION,
    sampleCount,
    dominantPrimaryTag,
    primaryTagShares,
    codeSwitchRate,
    homeLanguageHintSet: [...homeHintSet].sort(),
    localizedCohort: hasLocalizationSignals,
  };
}

export function buildLocalePolicyContext(params: {
  samples: LocaleSignalSample[];
  plannerChosenTaskType: string;
  requestedType?: string | null;
  blockOverride?: boolean;
}) : LocalePolicyContext {
  const profile = summarizeLocalePolicyProfile(params.samples);
  const reasonCodes: string[] = [];

  if (profile.primaryTagShares.swahili >= 0.12) reasonCodes.push("swahili_primary_pattern");
  if (profile.primaryTagShares.sheng >= 0.1) reasonCodes.push("sheng_primary_pattern");
  if (profile.codeSwitchRate >= 0.2) reasonCodes.push("code_switch_high");
  if (profile.homeLanguageHintSet.length > 0) reasonCodes.push("home_language_hints_present");

  let overrideTaskType: string | null = null;
  if (!params.blockOverride && !params.requestedType) {
    if (profile.codeSwitchRate >= 0.2 || profile.primaryTagShares.sheng >= 0.12) {
      overrideTaskType = "role_play";
    } else if (profile.primaryTagShares.swahili >= 0.18) {
      overrideTaskType = "qa_prompt";
    } else if (profile.homeLanguageHintSet.length > 0) {
      overrideTaskType = "topic_talk";
    }
  }
  if (overrideTaskType === params.plannerChosenTaskType) {
    overrideTaskType = null;
  }

  return {
    profile,
    adaptation: {
      version: LOCALE_POLICY_CONTEXT_VERSION,
      applied: profile.localizedCohort,
      overrideTaskType,
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : profile.localizedCohort ? ["localized_signals_detected"] : [],
    },
  };
}
