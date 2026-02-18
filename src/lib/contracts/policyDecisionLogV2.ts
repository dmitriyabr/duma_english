import { z } from "zod";
import {
  policyDecisionLogV2ContractSchema,
  type PolicyDecisionLogV2Contract,
} from "@/lib/db/types";

export const policyDecisionLogV2IssueSchema = z.object({
  decisionLogId: z.string(),
  reason: z.string(),
});

export const policyDecisionLogV2DashboardSchema = z.object({
  generatedAt: z.string().datetime(),
  windowDays: z.number().int().positive(),
  totalLogs: z.number().int().nonnegative(),
  validLogs: z.number().int().nonnegative(),
  invalidLogs: z.number().int().nonnegative(),
  invalidRate: z.number().min(0).max(1),
  reasons: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
  policyVersions: z.array(
    z.object({
      policyVersion: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
});

export type PolicyDecisionLogV2Issue = z.infer<typeof policyDecisionLogV2IssueSchema>;
export type PolicyDecisionLogV2Dashboard = z.infer<typeof policyDecisionLogV2DashboardSchema>;

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asScoreMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || key.trim().length === 0) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[key] = raw;
  }
  return out;
}

export function normalizePolicyDecisionLogV2Row(row: {
  decisionLogId: string;
  studentId: string;
  policyVersion: string;
  contextSnapshotId: string | null;
  candidateActionSet: unknown;
  preActionScores: unknown;
  propensity: number | null;
  activeConstraints: string[];
  linkageTaskId: string | null;
  linkageAttemptId: string | null;
  linkageSessionId: string | null;
  source: string;
}): PolicyDecisionLogV2Contract {
  return {
    decisionLogId: row.decisionLogId,
    studentId: row.studentId,
    policyVersion: row.policyVersion,
    contextSnapshotId: row.contextSnapshotId || undefined,
    candidateActionSet: asStringArray(row.candidateActionSet),
    preActionScores: asScoreMap(row.preActionScores),
    propensity: typeof row.propensity === "number" ? row.propensity : undefined,
    activeConstraints: row.activeConstraints,
    linkageTaskId: row.linkageTaskId || undefined,
    linkageAttemptId: row.linkageAttemptId || undefined,
    linkageSessionId: row.linkageSessionId || undefined,
    source: row.source === "runtime_v2" ? "runtime_v2" : "sql_trigger_v1",
  };
}

export function validatePolicyDecisionLogV2Row(row: PolicyDecisionLogV2Contract) {
  const issues: string[] = [];
  const parsed = policyDecisionLogV2ContractSchema.safeParse(row);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(issue.message);
    }
  }
  if (!row.contextSnapshotId) {
    issues.push("missing contextSnapshotId");
  }
  if (!row.linkageTaskId) {
    issues.push("missing linkageTaskId");
  }
  if (!row.linkageAttemptId) {
    issues.push("missing linkageAttemptId");
  }
  if (typeof row.propensity !== "number") {
    issues.push("missing propensity");
  }
  return {
    valid: issues.length === 0,
    issues,
  };
}
