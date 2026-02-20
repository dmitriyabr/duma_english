import { z } from "zod";

export const MODEL_PROMPT_REGISTRY_VERSION = "model-prompt-registry-v1" as const;

export const modelPromptRegistrySchema = z.object({
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(MODEL_PROMPT_REGISTRY_VERSION),
  releaseTag: z.string().min(1),
  evaluatorModelVersion: z.string(),
  causalInferenceModelVersion: z.string(),
  causalTaxonomyVersion: z.string(),
  causalRemediationPolicyVersion: z.string(),
  policyVersion: z.string(),
  rewardVersion: z.string(),
  shadowModelVersion: z.string(),
  taskGeneratorPromptVersion: z.string(),
});

export type ModelPromptRegistry = z.infer<typeof modelPromptRegistrySchema>;
