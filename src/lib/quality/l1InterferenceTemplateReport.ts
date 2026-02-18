import { prisma } from "@/lib/db";
import {
  l1InterferenceTemplateReportSchema,
  type L1InterferenceTemplateReport,
} from "@/lib/contracts/l1InterferenceTemplateReport";
import { L1_INTERFERENCE_PRIOR_VERSION } from "@/lib/localization/interferencePrior";

const DAY_MS = 24 * 60 * 60 * 1000;

type DecisionRow = {
  utilityJson: unknown;
};

type ParsedCausalRemediation = {
  evaluated: boolean;
  topCauseLabel: string | null;
  chosenTemplateKey: string | null;
  chosenTemplateTitle: string | null;
  chosenDomain: string | null;
  ageBand: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function sortCountRows(map: Map<string, number>) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function ratioOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function parseCausalRemediation(utilityJson: unknown): ParsedCausalRemediation | null {
  const utility = asObject(utilityJson);
  const causalRemediation = asObject(utility.causalRemediation);
  if (Object.keys(causalRemediation).length === 0) return null;

  const interferencePrior = asObject(causalRemediation.interferencePrior);
  return {
    evaluated: asBoolean(causalRemediation.applied),
    topCauseLabel: asString(causalRemediation.topCauseLabel),
    chosenTemplateKey: asString(causalRemediation.chosenTemplateKey),
    chosenTemplateTitle: asString(causalRemediation.chosenTemplateTitle),
    chosenDomain: asString(causalRemediation.chosenDomain),
    ageBand: asString(interferencePrior.ageBand),
  };
}

export function summarizeL1InterferenceTemplateMappings(params: {
  rows: DecisionRow[];
  windowDays: number;
  now?: Date;
}): L1InterferenceTemplateReport {
  const now = params.now || new Date();
  const ageBandCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  const templateCounts = new Map<string, { title: string; count: number }>();
  const causeTemplateCounts = new Map<string, number>();

  let causalRemediationEvaluatedCount = 0;
  let l1TopCauseCount = 0;
  let templatedL1Count = 0;
  let missingTemplateForL1Count = 0;

  for (const row of params.rows) {
    const parsed = parseCausalRemediation(row.utilityJson);
    if (!parsed) continue;
    if (parsed.evaluated) {
      causalRemediationEvaluatedCount += 1;
    }
    if (parsed.topCauseLabel !== "l1_interference") continue;

    l1TopCauseCount += 1;
    const ageBand = parsed.ageBand || "unknown";
    ageBandCounts.set(ageBand, (ageBandCounts.get(ageBand) || 0) + 1);

    const domain = parsed.chosenDomain || "unknown";
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);

    if (!parsed.chosenTemplateKey) {
      missingTemplateForL1Count += 1;
      continue;
    }

    templatedL1Count += 1;
    const templateTitle = parsed.chosenTemplateTitle || parsed.chosenTemplateKey;
    const templateRow = templateCounts.get(parsed.chosenTemplateKey) || {
      title: templateTitle,
      count: 0,
    };
    templateRow.count += 1;
    templateCounts.set(parsed.chosenTemplateKey, templateRow);

    const mappingKey = `${parsed.topCauseLabel}::${parsed.chosenTemplateKey}`;
    causeTemplateCounts.set(mappingKey, (causeTemplateCounts.get(mappingKey) || 0) + 1);
  }

  const templateBreakdown = [...templateCounts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .map(([templateKey, row]) => ({
      templateKey,
      templateTitle: row.title,
      count: row.count,
    }));
  const causeTemplateMappings = [...causeTemplateCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([mappingKey, count]) => {
      const [causeLabel, templateKey] = mappingKey.split("::");
      return {
        causeLabel,
        templateKey,
        count,
      };
    });

  return l1InterferenceTemplateReportSchema.parse({
    generatedAt: now.toISOString(),
    priorVersion: L1_INTERFERENCE_PRIOR_VERSION,
    windowDays: params.windowDays,
    totalDecisionLogs: params.rows.length,
    causalRemediationEvaluatedCount,
    l1TopCauseCount,
    templatedL1Count,
    missingTemplateForL1Count,
    templatedL1Rate: ratioOrNull(templatedL1Count, l1TopCauseCount),
    ageBandBreakdown: sortCountRows(ageBandCounts),
    domainBreakdown: sortCountRows(domainCounts),
    templateBreakdown,
    causeTemplateMappings,
  });
}

export async function buildL1InterferenceTemplateReport(params?: {
  windowDays?: number;
  limit?: number;
  now?: Date;
}): Promise<L1InterferenceTemplateReport> {
  const now = params?.now || new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(params?.limit ?? 20000)));
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const rows = await prisma.plannerDecisionLog.findMany({
    where: {
      decisionTs: { gte: since },
    },
    orderBy: { decisionTs: "desc" },
    take: limit,
    select: {
      utilityJson: true,
    },
  });

  return summarizeL1InterferenceTemplateMappings({
    rows,
    windowDays,
    now,
  });
}
