import { CAUSAL_TAXONOMY_V1_VERSION } from "@/lib/db/types";
import { CAUSAL_REMEDIATION_POLICY_VERSION } from "@/lib/causal/remediationPolicy";
import { CAUSAL_INFERENCE_MODEL_VERSION } from "@/lib/causal/inference";
import { EVALUATOR_MODEL_VERSION } from "@/lib/evaluator";
import { POLICY_VERSION } from "@/lib/policy/hybridSelector";
import { REWARD_FUNCTION_VERSION_V1 } from "@/lib/reward/function";
import { SHADOW_POLICY_MODEL_VERSION } from "@/lib/contracts/shadowPolicyDashboard";
import {
  MODEL_PROMPT_REGISTRY_VERSION,
  modelPromptRegistrySchema,
  type ModelPromptRegistry,
} from "@/lib/contracts/modelPromptRegistry";

/** Task generator prompt version; no separate module yet. */
const TASK_GENERATOR_PROMPT_VERSION = "task-generator-prompt-v1" as const;

/**
 * Returns current release tag for reproducibility.
 * Set REGISTRY_RELEASE_TAG in env for immutable release pins.
 */
export function getReleaseTag(): string {
  const fromEnv = process.env.REGISTRY_RELEASE_TAG;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `release-${y}-${m}-${d}`;
}

/**
 * Builds the current model/prompt registry snapshot from versioned modules.
 * Used for tracing and immutable release tagging (CH-40).
 */
export function getModelPromptRegistry(params?: { now?: Date; releaseTag?: string }): ModelPromptRegistry {
  const now = params?.now ?? new Date();
  const releaseTag = params?.releaseTag ?? getReleaseTag();
  const snapshot = {
    generatedAt: now.toISOString(),
    contractVersion: MODEL_PROMPT_REGISTRY_VERSION,
    releaseTag,
    evaluatorModelVersion: EVALUATOR_MODEL_VERSION,
    causalInferenceModelVersion: CAUSAL_INFERENCE_MODEL_VERSION,
    causalTaxonomyVersion: CAUSAL_TAXONOMY_V1_VERSION,
    causalRemediationPolicyVersion: CAUSAL_REMEDIATION_POLICY_VERSION,
    policyVersion: POLICY_VERSION,
    rewardVersion: REWARD_FUNCTION_VERSION_V1,
    shadowModelVersion: SHADOW_POLICY_MODEL_VERSION,
    taskGeneratorPromptVersion: TASK_GENERATOR_PROMPT_VERSION,
  };
  return modelPromptRegistrySchema.parse(snapshot);
}
