import type { DomainStages } from "@/lib/gse/stageProjection";
import type { RetentionPromotionGateResult } from "@/lib/retention/promotionGate";

const STAGE_ORDER = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

type ClaimEvidenceAttempt = {
  createdAt: Date;
  taskType: string;
  taskScore: number | null;
  discourseOverallScore: number | null;
  discoursePassByDimension: Record<string, boolean> | null;
};

export type C2ClaimStatus = {
  level: "C2";
  certified: boolean;
  certificationTimestamp: string | null;
  modalities: {
    speaking: { passed: boolean; stage: string; evidenceCount: number };
    listening: { passed: boolean; stage: string; evidenceCount: number };
    reading: { passed: boolean; stage: string; evidenceCount: number };
    writing: { passed: boolean; stage: string; evidenceCount: number };
  };
  grammar: { passed: boolean; stage: string };
  vocabulary: { passed: boolean; stage: string };
  discourse: { passed: boolean; evidenceCount: number; avgScore: number | null };
  pragmatics: { passed: boolean; evidenceCount: number };
  durability: { passed: boolean; mode: string; blockerReasons: string[] };
  missingEvidence: string[];
};

function stageIndex(stage: string) {
  const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return idx === -1 ? 0 : idx;
}

function stagePassed(stage: string, minStage: "C2" | "C1" = "C2") {
  return stageIndex(stage) >= stageIndex(minStage);
}

function evidenceCountForTaskTypes(
  attempts: ClaimEvidenceAttempt[],
  taskTypes: string[],
  minScore = 70,
) {
  return attempts.filter(
    (attempt) =>
      taskTypes.includes(attempt.taskType) &&
      typeof attempt.taskScore === "number" &&
      attempt.taskScore >= minScore,
  ).length;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function buildC2ClaimStatus(params: {
  domainStages: DomainStages;
  retentionCertification: RetentionPromotionGateResult;
  attempts: ClaimEvidenceAttempt[];
}): C2ClaimStatus {
  const speakingEvidence = evidenceCountForTaskTypes(
    params.attempts,
    ["topic_talk", "qa_prompt", "role_play", "speech_builder", "argumentation", "register_switch"],
  );
  const listeningEvidence = evidenceCountForTaskTypes(params.attempts, ["listening_comprehension"]);
  const readingEvidence = evidenceCountForTaskTypes(params.attempts, ["reading_comprehension"]);
  const writingEvidence = evidenceCountForTaskTypes(params.attempts, ["writing_prompt"]);

  const discourseAttempts = params.attempts.filter(
    (attempt) =>
      ["argumentation", "register_switch", "misunderstanding_repair"].includes(attempt.taskType) &&
      typeof attempt.discourseOverallScore === "number",
  );
  const discourseAvg = average(
    discourseAttempts
      .map((attempt) => attempt.discourseOverallScore)
      .filter((value): value is number => typeof value === "number"),
  );
  const pragmaticsEvidenceCount = discourseAttempts.filter(
    (attempt) =>
      attempt.discoursePassByDimension?.registerControl === true ||
      attempt.discoursePassByDimension?.turnTakingRepair === true ||
      attempt.discoursePassByDimension?.audienceFit === true,
  ).length;

  const modalities = {
    speaking: {
      passed: stagePassed(params.domainStages.speaking.stage) && speakingEvidence >= 3,
      stage: params.domainStages.speaking.stage,
      evidenceCount: speakingEvidence,
    },
    listening: {
      passed: stagePassed(params.domainStages.listening.stage) && listeningEvidence >= 3,
      stage: params.domainStages.listening.stage,
      evidenceCount: listeningEvidence,
    },
    reading: {
      passed: stagePassed(params.domainStages.reading.stage) && readingEvidence >= 3,
      stage: params.domainStages.reading.stage,
      evidenceCount: readingEvidence,
    },
    writing: {
      passed: stagePassed(params.domainStages.writing.stage) && writingEvidence >= 3,
      stage: params.domainStages.writing.stage,
      evidenceCount: writingEvidence,
    },
  };

  const grammar = {
    passed: stagePassed(params.domainStages.grammar.stage),
    stage: params.domainStages.grammar.stage,
  };
  const vocabulary = {
    passed: stagePassed(params.domainStages.vocab.stage),
    stage: params.domainStages.vocab.stage,
  };
  const discourse = {
    passed: discourseAttempts.length >= 5 && (discourseAvg ?? 0) >= 75,
    evidenceCount: discourseAttempts.length,
    avgScore: discourseAvg,
  };
  const pragmatics = {
    passed: pragmaticsEvidenceCount >= 4,
    evidenceCount: pragmaticsEvidenceCount,
  };
  const durability = {
    passed: params.retentionCertification.passed,
    mode: params.retentionCertification.mode,
    blockerReasons: params.retentionCertification.blockerReasons,
  };

  const missingEvidence: string[] = [];
  if (!modalities.speaking.passed) missingEvidence.push("speaking evidence below C2 claim threshold");
  if (!modalities.listening.passed) missingEvidence.push("listening evidence below C2 claim threshold");
  if (!modalities.reading.passed) missingEvidence.push("reading evidence below C2 claim threshold");
  if (!modalities.writing.passed) missingEvidence.push("writing evidence below C2 claim threshold");
  if (!grammar.passed) missingEvidence.push("grammar stage below C2");
  if (!vocabulary.passed) missingEvidence.push("vocabulary stage below C2");
  if (!discourse.passed) missingEvidence.push("advanced discourse evidence is incomplete");
  if (!pragmatics.passed) missingEvidence.push("pragmatics evidence is incomplete");
  if (!durability.passed) missingEvidence.push("durability certification is not passed");

  const certified = missingEvidence.length === 0;
  const certificationTimestamp = certified
    ? params.attempts
        .map((attempt) => attempt.createdAt)
        .sort((a, b) => b.getTime() - a.getTime())[0]
        ?.toISOString() ?? new Date().toISOString()
    : null;

  return {
    level: "C2",
    certified,
    certificationTimestamp,
    modalities,
    grammar,
    vocabulary,
    discourse,
    pragmatics,
    durability,
    missingEvidence,
  };
}

