import { prisma } from "@/lib/db";
import { applyEvidenceToStudentMastery, MasteryEvidence, NodeMasteryOutcome } from "./mastery";
import { confidenceFromReliability } from "./utils";

type DerivedMetrics = {
  speechRate?: number;
  pronunciationTargetRef?: number;
  pronunciationSelfRef?: number;
  pronunciation?: number;
  fluency?: number;
};

type TaskEvaluation = {
  taskScore: number;
  artifacts?: Record<string, unknown>;
};

export type BuildAttemptEvidenceInput = {
  attemptId: string;
  studentId: string;
  taskId: string;
  transcript: string;
  derivedMetrics: DerivedMetrics;
  taskEvaluation: TaskEvaluation;
  scoreReliability: "high" | "medium" | "low";
};

export function mapTranscriptToWordSet(input: string) {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, " ")
        .split(/\s+/)
      .filter(Boolean)
    )
  );
}

function confidenceForMetric(value: number | undefined) {
  if (typeof value !== "number") return 0.55;
  if (value >= 85) return 0.92;
  if (value >= 70) return 0.8;
  return 0.65;
}

export async function persistAttemptGseEvidence(input: BuildAttemptEvidenceInput) {
  const created: Array<{
    nodeId: string;
    signalType: string;
    confidence: number;
    impact: number;
    evidenceText?: string;
    reliability: "high" | "medium" | "low";
  }> = [];

  const taskTargets = await prisma.taskGseTarget.findMany({
    where: { taskId: input.taskId },
    include: { node: true },
  });
  const reliability = input.scoreReliability;
  const defaultConf = confidenceFromReliability(reliability);
  for (const target of taskTargets) {
    created.push({
      nodeId: target.nodeId,
      signalType: "task_target",
      confidence: Number((defaultConf * 0.95).toFixed(2)),
      impact: Number(Math.max(0.2, Math.min(1, target.weight)).toFixed(2)),
      evidenceText: input.transcript.slice(0, 220),
      reliability,
    });
  }

  const words = mapTranscriptToWordSet(input.transcript);
  if (words.length > 0) {
    const [vocabNodes, aliasRows] = await Promise.all([
      prisma.gseNode.findMany({
        where: {
          type: "GSE_VOCAB",
          sourceKey: { in: words },
        },
        select: { nodeId: true },
        take: 30,
      }),
      prisma.gseNodeAlias.findMany({
        where: { alias: { in: words } },
        select: { nodeId: true },
        take: 30,
      }),
    ]);
    const matchedNodeIds = Array.from(
      new Set([...vocabNodes.map((row) => row.nodeId), ...aliasRows.map((row) => row.nodeId)])
    );
    for (const nodeId of matchedNodeIds) {
      created.push({
        nodeId,
        signalType: "vocab_match",
        confidence: Number((defaultConf * 0.9).toFixed(2)),
        impact: 0.3,
        evidenceText: input.transcript.slice(0, 220),
        reliability: "medium",
      });
    }
  }

  const metricSignals: Array<{ key: string; score?: number; signalType: string }> = [
    {
      key: "pronunciation",
      score:
        input.derivedMetrics.pronunciationTargetRef ??
        input.derivedMetrics.pronunciationSelfRef ??
        input.derivedMetrics.pronunciation,
      signalType: "speech_pronunciation",
    },
    {
      key: "fluency",
      score: input.derivedMetrics.fluency,
      signalType: "speech_fluency",
    },
  ];
  const metricNodeKeys = metricSignals.map((s) => s.key);
  const metricNodes = await prisma.gseNode.findMany({
    where: {
      sourceKey: { in: metricNodeKeys },
    },
    select: { nodeId: true, sourceKey: true },
  });
  for (const signal of metricSignals) {
    const node = metricNodes.find((row) => row.sourceKey === signal.key);
    if (!node || typeof signal.score !== "number") continue;
    created.push({
      nodeId: node.nodeId,
      signalType: signal.signalType,
      confidence: confidenceForMetric(signal.score),
      impact: 0.5,
      evidenceText: `${signal.key}:${Math.round(signal.score)}`,
      reliability: signal.score >= 80 ? "high" : "medium",
    });
  }

  if (created.length === 0) {
    return { evidenceCount: 0, nodeOutcomes: [] as NodeMasteryOutcome[] };
  }

  const deduped = new Map<string, (typeof created)[number]>();
  for (const row of created) {
    const key = `${row.nodeId}|${row.signalType}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const rows = Array.from(deduped.values());

  await prisma.attemptGseEvidence.createMany({
    data: rows.map((row) => ({
      attemptId: input.attemptId,
      studentId: input.studentId,
      nodeId: row.nodeId,
      signalType: row.signalType,
      confidence: row.confidence,
      impact: row.impact,
      evidenceText: row.evidenceText || null,
    })),
  });

  const masteryEvidences: MasteryEvidence[] = rows.map((row) => ({
    nodeId: row.nodeId,
    confidence: row.confidence,
    impact: row.impact,
    reliability: row.reliability,
  }));
  const nodeOutcomes = await applyEvidenceToStudentMastery({
    studentId: input.studentId,
    evidences: masteryEvidences,
    calculationVersion: "gse-mastery-v1",
  });

  return { evidenceCount: rows.length, nodeOutcomes };
}
