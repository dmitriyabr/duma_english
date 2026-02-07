import { prisma } from "@/lib/db";

export type GseReliability = "high" | "medium" | "low";
export type GseEvidenceKind = "direct" | "supporting" | "negative";
export type GseOpportunityType = "explicit_target" | "elicited_incidental" | "incidental";
export type NodeActivationState = "observed" | "candidate_for_verification" | "verified";
export type EvidenceActivationImpact = "none" | "observed" | "candidate" | "verified";

export type MasteryEvidence = {
  nodeId: string;
  confidence: number; // 0..1
  impact: number; // 0..1
  reliability: GseReliability;
  evidenceKind?: GseEvidenceKind;
  opportunityType?: GseOpportunityType;
  score?: number; // 0..1
  weight?: number; // precomputed weight in [0..1.5]
  usedForPromotion?: boolean;
  taskType?: string;
  targeted?: boolean;
};

export type NodeMasteryOutcome = {
  nodeId: string;
  previousMean: number;
  nextMean: number;
  previousDecayed: number;
  nextDecayed: number;
  deltaMastery: number;
  decayImpact: number;
  reliability: GseReliability;
  evidenceCount: number;
  alphaBefore: number;
  alphaAfter: number;
  betaBefore: number;
  betaAfter: number;
  activationStateBefore: NodeActivationState;
  activationStateAfter: NodeActivationState;
  activationImpact: EvidenceActivationImpact;
  verificationDueAt: string | null;
  /** When present, the evidence weight was multiplied by this (streak bonus). */
  streakMultiplier?: number;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function reliabilityFactor(reliability: GseReliability) {
  if (reliability === "high") return 1;
  if (reliability === "medium") return 0.78;
  return 0.58;
}

function defaultHalfLifeDays(nodeType: string | null, skill: string | null) {
  if (nodeType === "GSE_VOCAB" || skill === "vocabulary") return 14;
  if (nodeType === "GSE_GRAMMAR" || skill === "grammar") return 21;
  return 10;
}

function daysBetween(from: Date | null | undefined, to: Date) {
  if (!from) return 0;
  const ms = Math.max(0, to.getTime() - from.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function effectiveHalfLifeDays(base: number, evidenceCount: number, reliability: GseReliability) {
  const repetitionBoost = 1 + Math.log2(Math.max(1, evidenceCount + 1)) * 0.35;
  const reliabilityBoost = reliability === "high" ? 1.2 : reliability === "medium" ? 1 : 0.85;
  return Math.max(3, base * repetitionBoost * reliabilityBoost);
}

function baseWeight(kind: GseEvidenceKind, opportunity: GseOpportunityType) {
  if (kind === "direct" && opportunity === "explicit_target") return 1;
  if (kind === "direct" && opportunity === "elicited_incidental") return 0.8;
  // Supporting = самостоятельное использование; не хуже намеренного (0.8)
  if (kind === "supporting" && opportunity === "incidental") return 0.8;
  if (kind === "negative" && opportunity === "explicit_target") return 0.9;
  if (kind === "negative" && opportunity === "incidental") return 0.4;
  if (kind === "supporting") return 0.4;
  if (kind === "negative") return 0.55;
  return 0.5;
}

function deriveReliability(params: {
  directEvidenceCount: number;
  uncertainty: number;
  crossTaskEvidenceCount: number;
}) {
  const directScore = Math.min(1, params.directEvidenceCount / 12);
  const uncertaintyScore = 1 - Math.min(1, params.uncertainty / 0.45);
  const crossTaskScore = Math.min(1, params.crossTaskEvidenceCount / 8);
  const score = directScore * 0.45 + uncertaintyScore * 0.4 + crossTaskScore * 0.15;
  if (score >= 0.75) return "high" as const;
  if (score >= 0.5) return "medium" as const;
  return "low" as const;
}

function normalizeActivationState(value: string | null | undefined): NodeActivationState {
  if (value === "verified" || value === "candidate_for_verification" || value === "observed") return value;
  return "observed";
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function computeDecayedMastery(params: {
  masteryMean: number;
  lastEvidenceAt: Date | null;
  now: Date;
  halfLifeDays: number;
  evidenceCount: number;
  reliability: GseReliability;
}) {
  const deltaDays = daysBetween(params.lastEvidenceAt, params.now);
  const halfLife = effectiveHalfLifeDays(
    params.halfLifeDays,
    params.evidenceCount,
    params.reliability
  );
  const decay = Math.exp((-Math.log(2) * deltaDays) / halfLife);
  return Number(clamp(params.masteryMean * decay).toFixed(2));
}

export function computeNextMasteryScore(current: number, evidence: MasteryEvidence) {
  const kind = evidence.evidenceKind || "direct";
  const opportunity = evidence.opportunityType || "explicit_target";
  const score = clamp01(
    typeof evidence.score === "number"
      ? evidence.score
      : clamp01(0.5 + evidence.confidence * evidence.impact * 0.5)
  );
  const weight =
    typeof evidence.weight === "number"
      ? clamp01(evidence.weight)
      : clamp01(baseWeight(kind, opportunity) * evidence.confidence * reliabilityFactor(evidence.reliability));
  const alpha = Math.max(1, (current / 100) * 8) + weight * score;
  const beta = Math.max(1, (1 - current / 100) * 8) + weight * (1 - score);
  return Number(clamp((alpha / (alpha + beta)) * 100).toFixed(2));
}

export async function applyEvidenceToStudentMastery(params: {
  studentId: string;
  evidences: MasteryEvidence[];
  calculationVersion: string;
}) {
  const outcomes: NodeMasteryOutcome[] = [];
  const now = new Date();

  for (const evidence of params.evidences) {
    const existing = await prisma.studentGseMastery.findUnique({
      where: {
        studentId_nodeId: {
          studentId: params.studentId,
          nodeId: evidence.nodeId,
        },
      },
      include: {
        node: {
          select: {
            type: true,
            skill: true,
          },
        },
      },
    });
    const spacingStateRaw =
      existing?.spacingStateJson && typeof existing.spacingStateJson === "object"
        ? (existing.spacingStateJson as Record<string, unknown>)
        : {};
    const incidentalTaskTypes = Array.isArray(spacingStateRaw.incidentalTaskTypes)
      ? spacingStateRaw.incidentalTaskTypes
          .map((value) => String(value))
          .filter(Boolean)
      : [];
    const incidentalConfidences = Array.isArray(spacingStateRaw.incidentalConfidences)
      ? spacingStateRaw.incidentalConfidences
          .map((value) => (typeof value === "number" ? value : Number(value)))
          .filter((value) => Number.isFinite(value))
      : [];
    const directSuccessStreak =
      typeof spacingStateRaw.directSuccessStreak === "number" && spacingStateRaw.directSuccessStreak >= 0
        ? spacingStateRaw.directSuccessStreak
        : 0;
    const activationStateBefore = normalizeActivationState(existing?.activationState);

    // Trust alpha/beta as the single source of truth when they exist; fall back to stored mean otherwise.
    const storedMean = existing?.masteryMean ?? existing?.masteryScore ?? 25;
    const alphaFromStore = typeof existing?.alpha === "number" && existing.alpha > 0 ? existing.alpha : null;
    const betaFromStore = typeof existing?.beta === "number" && existing.beta > 0 ? existing.beta : null;
    const meanFromAlphaBeta =
      alphaFromStore && betaFromStore
        ? clamp((alphaFromStore / (alphaFromStore + betaFromStore)) * 100)
        : null;

    // If alpha/beta imply a different mean, prefer that to avoid fake drops when the cached mean drifted.
    const previousMean =
      meanFromAlphaBeta !== null && Math.abs(meanFromAlphaBeta - storedMean) > 0.25
        ? meanFromAlphaBeta
        : storedMean;

    const previousScore01 = clamp01(previousMean / 100);
    const priorStrength = Math.max(4, (existing?.evidenceCount ?? 0) + 4);
    let alphaBefore = alphaFromStore ?? Math.max(1, previousScore01 * priorStrength);
    let betaBefore = betaFromStore ?? Math.max(1, (1 - previousScore01) * priorStrength);

    const POSTERIOR_STRENGTH_CAP = 12;
    const sumBefore = alphaBefore + betaBefore;
    if (sumBefore > POSTERIOR_STRENGTH_CAP) {
      const scale = POSTERIOR_STRENGTH_CAP / sumBefore;
      alphaBefore = alphaBefore * scale;
      betaBefore = betaBefore * scale;
    }

    const kind: GseEvidenceKind = evidence.evidenceKind || "direct";
    const opportunity: GseOpportunityType = evidence.opportunityType || "explicit_target";
    const score = clamp01(
      typeof evidence.score === "number"
        ? evidence.score
        : evidence.reliability === "low"
        ? evidence.confidence * evidence.impact * 0.8
        : evidence.confidence * evidence.impact
    );
    const maxWeight = 2; // allow higher streak bonus to speed progression
    const conf = clamp01(evidence.confidence);
    const rel = reliabilityFactor(evidence.reliability);
    const imp = Math.max(0.2, clamp01(evidence.impact));
    // Reference: what one direct+explicit_target would get with same conf/rel/impact (base 1.0)
    const refDirectWeight = 1.0 * conf * rel * imp;
    let effectiveWeight: number;
    if (typeof evidence.weight === "number") {
      effectiveWeight = Math.max(0.05, Math.min(maxWeight, evidence.weight));
    } else if (kind === "supporting" && opportunity === "incidental") {
      // By definition: supporting+incidental = 0.8 × direct (same conf/rel/impact)
      effectiveWeight = 0.8 * refDirectWeight;
    } else {
      effectiveWeight = baseWeight(kind, opportunity) * conf * rel * imp;
    }
    effectiveWeight = Math.max(0.05, Math.min(maxWeight, effectiveWeight));

    // Success = direct (score≥0.7) OR supporting (score≥0.6). Уместное использование слова засчитывается и даёт стрик.
    const directSuccess = kind === "direct" && score >= 0.7;
    const supportingSuccess = kind === "supporting" && score >= 0.6;
    const success = directSuccess || supportingSuccess;
    const nextStreak = success ? directSuccessStreak + 1 : 0;

    if (score >= 0.6) effectiveWeight *= 1.1;
    else if (score < 0.4) effectiveWeight *= 0.9;
    // Streak bonus: 2nd in a row ×1.25, 3rd ×1.56, 4th+ ×1.8 (base 1.25, cap 1.8)
    let streakMultiplierApplied: number | undefined;
    if (success && directSuccessStreak >= 1) {
      streakMultiplierApplied = Math.min(1.8, 1.25 ** Math.min(directSuccessStreak, 3));
      effectiveWeight *= streakMultiplierApplied;
    }
    effectiveWeight = Math.max(0.05, Math.min(maxWeight, effectiveWeight));

    let alphaAfter = alphaBefore + effectiveWeight * score;
    let betaAfter = betaBefore + effectiveWeight * (1 - score);
    const total = alphaAfter + betaAfter;
    if (total > POSTERIOR_STRENGTH_CAP) {
      const scale = POSTERIOR_STRENGTH_CAP / total;
      alphaAfter = alphaAfter * scale;
      betaAfter = betaAfter * scale;
    }
    const nextMean = Number(clamp((alphaAfter / (alphaAfter + betaAfter)) * 100).toFixed(2));
    const nextUncertainty = Number((1 / Math.sqrt(Math.max(2, alphaAfter + betaAfter))).toFixed(4));

    const previousReliability = (existing?.reliability as GseReliability | null) || "low";
    const nextCount = (existing?.evidenceCount ?? 0) + 1;
    const directEvidenceCount =
      (existing?.directEvidenceCount ?? 0) + (kind === "direct" ? 1 : 0);
    const negativeEvidenceCount =
      (existing?.negativeEvidenceCount ?? 0) + (kind === "negative" ? 1 : 0);
    const crossTaskEvidenceCount =
      (existing?.crossTaskEvidenceCount ?? 0) + (opportunity === "incidental" ? 1 : 0);
    const supportingEvidenceCount =
      (existing?.supportingEvidenceCount ?? 0) + (kind === "supporting" ? 1 : 0);

    const derivedReliability = deriveReliability({
      directEvidenceCount,
      uncertainty: nextUncertainty,
      crossTaskEvidenceCount,
    });
    const reliability: GseReliability =
      previousReliability === "high" && derivedReliability === "medium"
        ? "high"
        : derivedReliability;

    const previousHalfLife =
      existing?.halfLifeDays ??
      defaultHalfLifeDays(existing?.node?.type || null, existing?.node?.skill || null);
    let previousDecayed =
      existing?.decayedMastery ??
      computeDecayedMastery({
        masteryMean: previousMean,
        lastEvidenceAt: existing?.lastEvidenceAt ?? null,
        now,
        halfLifeDays: previousHalfLife,
        evidenceCount: existing?.evidenceCount ?? 0,
        reliability: previousReliability,
      });
    // Stale decayed can be above mean after alpha/beta was corrected down; cap so decayImpact stays >= 0.
    if (previousDecayed > previousMean) previousDecayed = previousMean;

    const nextHalfLife = Number(
      Math.max(
        previousHalfLife,
        defaultHalfLifeDays(existing?.node?.type || null, existing?.node?.skill || null)
      ).toFixed(2)
    );
    const nextDecayed = computeDecayedMastery({
      masteryMean: nextMean,
      lastEvidenceAt: now,
      now,
      halfLifeDays: nextHalfLife,
      evidenceCount: nextCount,
      reliability,
    });

    const incidentalObserved =
      kind === "supporting" && opportunity === "incidental" && evidence.targeted === false;
    const nextIncidentalTaskTypes = [...incidentalTaskTypes];
    const nextIncidentalConfidences = [...incidentalConfidences];
    if (incidentalObserved) {
      if (evidence.taskType && !nextIncidentalTaskTypes.includes(evidence.taskType)) {
        nextIncidentalTaskTypes.push(evidence.taskType);
      }
      nextIncidentalConfidences.push(clamp01(evidence.confidence));
      while (nextIncidentalConfidences.length > 12) nextIncidentalConfidences.shift();
    }
    const incidentalTaskTypeCount = nextIncidentalTaskTypes.length;
    const incidentalMedianConfidence = median(nextIncidentalConfidences);

    let activationStateAfter: NodeActivationState = activationStateBefore;
    let activationImpact: EvidenceActivationImpact = "none";
    let verificationDueAt: Date | null = existing?.verificationDueAt ?? null;

    const verificationPass =
      kind === "direct" &&
      opportunity === "explicit_target" &&
      score >= 0.7 &&
      evidence.confidence >= 0.75 &&
      evidence.usedForPromotion !== false;

    if (activationStateBefore !== "verified" && verificationPass) {
      activationStateAfter = "verified";
      verificationDueAt = null;
      activationImpact = "verified";
    } else if (
      activationStateBefore !== "verified" &&
      nextStreak >= 2 &&
      directSuccess
    ) {
      activationStateAfter = "verified";
      verificationDueAt = null;
      activationImpact = "verified";
    } else if (activationStateBefore !== "verified") {
      if (incidentalObserved && activationStateBefore === "observed") {
        activationImpact = "observed";
      }
      const candidateReady =
        nextIncidentalConfidences.length >= 3 &&
        incidentalTaskTypeCount >= 2 &&
        incidentalMedianConfidence >= 0.7;
      if (candidateReady) {
        if (activationStateBefore !== "candidate_for_verification") {
          activationImpact = "candidate";
        }
        activationStateAfter = "candidate_for_verification";
        verificationDueAt = verificationDueAt || now;
      }
    }

    await prisma.studentGseMastery.upsert({
      where: {
        studentId_nodeId: {
          studentId: params.studentId,
          nodeId: evidence.nodeId,
        },
      },
      update: {
        masteryScore: nextMean,
        masteryMean: nextMean,
        masterySigma: Number((nextUncertainty * 100).toFixed(2)),
        uncertainty: nextUncertainty,
        alpha: alphaAfter,
        beta: betaAfter,
        decayedMastery: nextDecayed,
        halfLifeDays: nextHalfLife,
        reliability,
        evidenceCount: nextCount,
        directEvidenceCount,
        supportingEvidenceCount,
        negativeEvidenceCount,
        crossTaskEvidenceCount,
        incidentalTaskTypeCount,
        activationState: activationStateAfter,
        verificationDueAt,
        lastEvidenceAt: now,
        spacingStateJson: {
          incidentalTaskTypes: nextIncidentalTaskTypes,
          incidentalConfidences: nextIncidentalConfidences,
          directSuccessStreak: nextStreak,
        },
        calculationVersion: params.calculationVersion,
      },
      create: {
        studentId: params.studentId,
        nodeId: evidence.nodeId,
        masteryScore: nextMean,
        masteryMean: nextMean,
        masterySigma: Number((nextUncertainty * 100).toFixed(2)),
        uncertainty: nextUncertainty,
        alpha: alphaAfter,
        beta: betaAfter,
        decayedMastery: nextDecayed,
        halfLifeDays: nextHalfLife,
        reliability,
        evidenceCount: nextCount,
        directEvidenceCount,
        supportingEvidenceCount,
        negativeEvidenceCount,
        crossTaskEvidenceCount,
        incidentalTaskTypeCount,
        activationState: activationStateAfter,
        verificationDueAt,
        lastEvidenceAt: now,
        spacingStateJson: {
          incidentalTaskTypes: nextIncidentalTaskTypes,
          incidentalConfidences: nextIncidentalConfidences,
          directSuccessStreak: nextStreak,
        },
        calculationVersion: params.calculationVersion,
      },
    });

    outcomes.push({
      nodeId: evidence.nodeId,
      previousMean,
      nextMean,
      previousDecayed,
      nextDecayed,
      deltaMastery: Number((nextMean - previousMean).toFixed(2)),
      decayImpact: Number((previousMean - previousDecayed).toFixed(2)),
      reliability,
      evidenceCount: nextCount,
      alphaBefore: Number(alphaBefore.toFixed(4)),
      alphaAfter: Number(alphaAfter.toFixed(4)),
      betaBefore: Number(betaBefore.toFixed(4)),
      betaAfter: Number(betaAfter.toFixed(4)),
      activationStateBefore,
      activationStateAfter,
      activationImpact,
      verificationDueAt: verificationDueAt ? verificationDueAt.toISOString() : null,
      ...(streakMultiplierApplied !== undefined && { streakMultiplier: streakMultiplierApplied }),
    });
  }

  return outcomes;
}
