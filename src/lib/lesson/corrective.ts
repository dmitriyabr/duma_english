import { buildImmediateSelfRepairPromptGenerated } from "@/lib/selfRepair/immediateLoop";
import type { PronunciationDrillPlan, PronunciationIssue } from "@/lib/contracts/pronunciationPinpoint";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSeverity(score: number) {
  if (score <= 55) return "high" as const;
  if (score <= 70) return "medium" as const;
  return "low" as const;
}

export function derivePronunciationIssuesFromAttempt(attempt: {
  pronunciationIssuesJson?: unknown;
  speechMetricsJson?: unknown;
}): PronunciationIssue[] {
  const explicit = Array.isArray(attempt.pronunciationIssuesJson)
    ? attempt.pronunciationIssuesJson
        .map((row) => {
          const parsed = asObject(row);
          const label = typeof parsed.label === "string" ? parsed.label : null;
          const hint = typeof parsed.hint === "string" ? parsed.hint : null;
          if (!label || !hint) return null;
          const severityRaw = parsed.severity;
          const severity = severityRaw === "high" || severityRaw === "medium" || severityRaw === "low"
            ? severityRaw
            : "medium";
          return {
            id: typeof parsed.id === "string" ? parsed.id : `issue_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
            label,
            severity,
            hint,
            cue: typeof parsed.cue === "string" ? parsed.cue : "Say it slowly, then at natural speed.",
          };
        })
        .filter((row): row is PronunciationIssue => row !== null)
    : [];

  if (explicit.length > 0) return explicit.slice(0, 3);

  const metrics = asObject(attempt.speechMetricsJson);
  const fluency = asNumber(metrics.fluency);
  const pronunciation = asNumber(metrics.pronunciationTargetRef) ?? asNumber(metrics.pronunciationSelfRef) ?? asNumber(metrics.pronunciation) ?? asNumber(metrics.accuracy);
  const prosody = asNumber(metrics.prosody);

  const issues: PronunciationIssue[] = [];

  if (pronunciation !== null && pronunciation < 75) {
    issues.push({
      id: "vowel_stress_precision",
      label: "Sound precision",
      severity: normalizeSeverity(pronunciation),
      hint: "Open vowel sounds clearly and keep final consonants audible.",
      cue: "Speak each target word once slowly, once normally.",
    });
  }

  if (fluency !== null && fluency < 72) {
    issues.push({
      id: "speech_flow",
      label: "Speech flow",
      severity: normalizeSeverity(fluency),
      hint: "Use short chunks and smooth linking between words.",
      cue: "Pause only at commas or full stops.",
    });
  }

  if (prosody !== null && prosody < 70) {
    issues.push({
      id: "intonation_control",
      label: "Intonation",
      severity: normalizeSeverity(prosody),
      hint: "Lift your voice for key meaning words and fall at the end.",
      cue: "Underline key words and stress them slightly.",
    });
  }

  if (issues.length === 0) {
    issues.push({
      id: "clarity_general",
      label: "Clear delivery",
      severity: "medium",
      hint: "Speak a bit slower and keep each sentence complete.",
      cue: "One idea per sentence, then short pause.",
    });
  }

  return issues.slice(0, 2);
}

export function buildPronunciationDrillPlan(params: {
  sourcePrompt: string;
  issues: PronunciationIssue[];
}): PronunciationDrillPlan {
  const focus = params.issues[0]?.label || "Clear delivery";
  const microDrillLines = [
    `Repeat after coach: ${params.sourcePrompt}`,
    ...params.issues.map((issue) => `${issue.label}: ${issue.cue}`),
  ].slice(0, 4);

  return {
    focus,
    issues: params.issues.slice(0, 2),
    microDrillLines,
    replayCount: 2,
  };
}

export async function buildCorrectivePrompt(params: {
  sourcePrompt: string;
  causeLabel: string | null;
  feedback: unknown;
  drillPlan: PronunciationDrillPlan;
}) {
  const base = await buildImmediateSelfRepairPromptGenerated({
    sourcePrompt: params.sourcePrompt,
    causeLabel: params.causeLabel,
    feedback: params.feedback,
  });

  const drillHint = params.drillPlan.microDrillLines.join(" ");
  return `${base} Pronunciation focus: ${params.drillPlan.focus}. ${drillHint}`.replace(/\s+/g, " ").trim();
}
