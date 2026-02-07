import { z } from "zod";
import { buildTaskTemplate } from "./taskTemplates";

const generatedTaskSchema = z.object({
  task_type: z.string().min(2),
  instruction: z.string().min(20).max(420),
  constraints: z.object({
    minSeconds: z.number().int().min(5).max(120),
    maxSeconds: z.number().int().min(10).max(180),
  }),
  maxDurationSec: z.number().int().min(10).max(120),
  assessmentMode: z.enum(["pa", "stt"]),
  expected_artifacts: z.array(z.string()).max(12),
  scoring_hooks: z.array(z.string()).max(12),
  estimated_difficulty: z.number().min(0).max(100),
  target_nodes: z.array(z.string()).max(8),
});

type GenerateTaskSpecInput = {
  taskType: string;
  stage: string;
  ageBand: string;
  targetWords: string[];
  targetNodeIds: string[];
  focusSkills: string[];
  plannerReason: string;
  primaryGoal: string;
};

export type GeneratedTaskSpec = {
  taskType: string;
  prompt: string;
  constraints: { minSeconds: number; maxSeconds: number };
  maxDurationSec: number;
  assessmentMode: "pa" | "stt";
  expectedArtifacts: string[];
  scoringHooks: string[];
  estimatedDifficulty: number;
  targetNodes: string[];
  fallbackUsed: boolean;
  fallbackReason?: string;
  model?: string;
};

function fallbackTaskSpec(input: GenerateTaskSpecInput): GeneratedTaskSpec {
  const template = buildTaskTemplate(input.taskType, {
    targetWords: input.targetWords,
    stage: input.stage,
    reason: input.plannerReason,
    focusSkills: input.focusSkills,
  });
  return {
    taskType: template.type,
    prompt: template.prompt,
    constraints: template.constraints,
    maxDurationSec: template.maxDurationSec,
    assessmentMode: template.assessmentMode,
    expectedArtifacts: [
      "transcript",
      "task_completion",
      "speech_metrics",
    ],
    scoringHooks: input.focusSkills.slice(0, 3),
    estimatedDifficulty: input.stage === "A0" ? 30 : input.stage === "A1" ? 45 : input.stage === "A2" ? 58 : 70,
    targetNodes: input.targetNodeIds.slice(0, 6),
    fallbackUsed: true,
    fallbackReason: "deterministic_template",
  };
}

function coerceMode(value: unknown, taskType: string): "pa" | "stt" {
  if (value === "pa" || value === "stt") return value;
  return taskType === "read_aloud" ? "pa" : "stt";
}

function coerceDifficulty(value: unknown, stage: string) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    const fromNumber = Number(normalized);
    if (Number.isFinite(fromNumber)) return Math.max(0, Math.min(100, fromNumber));
    if (normalized === "easy") return 35;
    if (normalized === "medium") return 55;
    if (normalized === "hard") return 78;
  }
  if (stage === "A0") return 30;
  if (stage === "A1") return 45;
  if (stage === "A2") return 58;
  if (stage === "B1") return 70;
  if (stage === "B2") return 78;
  if (stage === "C1") return 86;
  return 92;
}

function coerceStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeGeneratedPayload(
  payload: unknown,
  input: GenerateTaskSpecInput,
  fallback: GeneratedTaskSpec
): GeneratedTaskSpec | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const taskType = typeof row.task_type === "string" ? row.task_type : input.taskType;
  const instruction =
    typeof row.instruction === "string" && row.instruction.trim().length >= 20
      ? row.instruction.trim()
      : fallback.prompt;
  const constraintsRaw = row.constraints as Record<string, unknown> | undefined;
  const minSeconds =
    typeof constraintsRaw?.minSeconds === "number" ? constraintsRaw.minSeconds : fallback.constraints.minSeconds;
  const maxSeconds =
    typeof constraintsRaw?.maxSeconds === "number" ? constraintsRaw.maxSeconds : fallback.constraints.maxSeconds;
  const maxDurationSec =
    typeof row.maxDurationSec === "number"
      ? row.maxDurationSec
      : Math.max(maxSeconds, fallback.maxDurationSec);
  const expectedArtifacts = coerceStringArray(row.expected_artifacts);
  const scoringHooks = coerceStringArray(row.scoring_hooks);
  const targetNodes = coerceStringArray(row.target_nodes);

  return {
    taskType,
    prompt: instruction,
    constraints: {
      minSeconds: Math.max(5, Math.min(120, Math.round(minSeconds))),
      maxSeconds: Math.max(10, Math.min(180, Math.round(maxSeconds))),
    },
    maxDurationSec: Math.max(10, Math.min(120, Math.round(maxDurationSec))),
    assessmentMode: coerceMode(row.assessmentMode, taskType),
    expectedArtifacts: expectedArtifacts.length ? expectedArtifacts.slice(0, 12) : fallback.expectedArtifacts,
    scoringHooks: scoringHooks.length ? scoringHooks.slice(0, 12) : fallback.scoringHooks,
    estimatedDifficulty: Math.round(coerceDifficulty(row.estimated_difficulty, input.stage)),
    targetNodes: targetNodes.length ? targetNodes.slice(0, 8) : fallback.targetNodes,
    fallbackUsed: false,
  };
}

export async function generateTaskSpec(input: GenerateTaskSpecInput): Promise<GeneratedTaskSpec> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const fallback = fallbackTaskSpec(input);
  if (!apiKey) return fallback;

  const prompt = [
    "Generate one speaking task for a child learner.",
    "Output JSON only with keys: task_type,instruction,constraints,maxDurationSec,assessmentMode,expected_artifacts,scoring_hooks,estimated_difficulty,target_nodes.",
    "Use simple child-friendly language and no method jargon.",
    "Keep instruction under 45 words.",
    `Stage: ${input.stage}`,
    `Age band: ${input.ageBand}`,
    `Task type required: ${input.taskType}`,
    `Primary goal: ${input.primaryGoal}`,
    `Target words: ${input.targetWords.join(", ") || "none"}`,
    `Target node IDs: ${input.targetNodeIds.join(", ") || "none"}`,
    `Focus skills: ${input.focusSkills.join(", ") || "speaking"}`,
    `Planner reason: ${input.plannerReason}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You design child English speaking tasks. Return strict JSON only with requested schema. No markdown.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.25,
        max_tokens: 420,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "generated_task",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                task_type: { type: "string" },
                instruction: { type: "string" },
                constraints: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    minSeconds: { type: "number" },
                    maxSeconds: { type: "number" },
                  },
                  required: ["minSeconds", "maxSeconds"],
                },
                maxDurationSec: { type: "number" },
                assessmentMode: { type: "string", enum: ["pa", "stt"] },
                expected_artifacts: { type: "array", items: { type: "string" } },
                scoring_hooks: { type: "array", items: { type: "string" } },
                estimated_difficulty: { type: "number" },
                target_nodes: { type: "array", items: { type: "string" } },
              },
              required: [
                "task_type",
                "instruction",
                "constraints",
                "maxDurationSec",
                "assessmentMode",
                "expected_artifacts",
                "scoring_hooks",
                "estimated_difficulty",
                "target_nodes",
              ],
            },
          },
        },
      }),
    });
    if (!response.ok) {
      return {
        ...fallback,
        fallbackReason: `openai_http_${response.status}`,
      };
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ...fallback,
        fallbackReason: "openai_empty_content",
      };
    }
    const json = JSON.parse(content);
    const normalized = normalizeGeneratedPayload(json, input, fallback);
    if (!normalized) {
      return {
        ...fallback,
        fallbackReason: "openai_invalid_payload",
      };
    }
    const parsed = generatedTaskSchema.parse({
      task_type: normalized.taskType,
      instruction: normalized.prompt,
      constraints: normalized.constraints,
      maxDurationSec: normalized.maxDurationSec,
      assessmentMode: normalized.assessmentMode,
      expected_artifacts: normalized.expectedArtifacts,
      scoring_hooks: normalized.scoringHooks,
      estimated_difficulty: normalized.estimatedDifficulty,
      target_nodes: normalized.targetNodes,
    });
    return {
      taskType: parsed.task_type,
      prompt: parsed.instruction,
      constraints: parsed.constraints,
      maxDurationSec: parsed.maxDurationSec,
      assessmentMode: parsed.assessmentMode,
      expectedArtifacts: parsed.expected_artifacts,
      scoringHooks: parsed.scoring_hooks,
      estimatedDifficulty: parsed.estimated_difficulty,
      targetNodes: parsed.target_nodes,
      fallbackUsed: false,
      model,
    };
  } catch {
    return {
      ...fallback,
      fallbackReason: "openai_exception",
    };
  }
}
