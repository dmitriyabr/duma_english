import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_PROMPT_REGISTRY_VERSION,
  modelPromptRegistrySchema,
} from "./modelPromptRegistry";

test("model prompt registry schema accepts valid payload", () => {
  const parsed = modelPromptRegistrySchema.parse({
    generatedAt: "2026-02-20T14:00:00.000Z",
    contractVersion: MODEL_PROMPT_REGISTRY_VERSION,
    releaseTag: "release-2026-02-20",
    evaluatorModelVersion: "eval-v2",
    causalInferenceModelVersion: "causal-inference-v1",
    causalTaxonomyVersion: "causal-taxonomy-v1",
    causalRemediationPolicyVersion: "cause-remediation-v1",
    policyVersion: "policy-hybrid-guardrailed-v1",
    rewardVersion: "reward-composite-v1",
    shadowModelVersion: "shadow-linear-contextual-v1",
    taskGeneratorPromptVersion: "task-generator-prompt-v1",
  });

  assert.equal(parsed.contractVersion, MODEL_PROMPT_REGISTRY_VERSION);
  assert.equal(parsed.releaseTag, "release-2026-02-20");
  assert.equal(parsed.evaluatorModelVersion, "eval-v2");
  assert.equal(parsed.policyVersion, "policy-hybrid-guardrailed-v1");
});
