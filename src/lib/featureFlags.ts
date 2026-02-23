function readFlagValue(raw: string | undefined, fallback: boolean) {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  return fallback;
}

function normalizeEnvKey(flag: string) {
  return flag.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

export function isFeatureEnabled(flag: string, fallback = true) {
  const normalized = normalizeEnvKey(flag);
  const direct = process.env[normalized];
  const prefixed = process.env[`FF_${normalized}`];
  if (typeof direct === "string") return readFlagValue(direct, fallback);
  if (typeof prefixed === "string") return readFlagValue(prefixed, fallback);
  return fallback;
}

export const featureFlags = {
  get listeningRuntimeV2() {
    return isFeatureEnabled("listening_runtime_v2", true);
  },
  get retentionGateV2() {
    return isFeatureEnabled("retention_gate_v2", true);
  },
  get memoryRuntimeV1() {
    return isFeatureEnabled("memory_runtime_v1", true);
  },
  get policyGateV1() {
    return isFeatureEnabled("policy_gate_v1", true);
  },
  get shadowModelV2() {
    return isFeatureEnabled("shadow_model_v2", true);
  },
};

export function getRuntimeFeatureFlags() {
  return {
    listening_runtime_v2: featureFlags.listeningRuntimeV2,
    retention_gate_v2: featureFlags.retentionGateV2,
    memory_runtime_v1: featureFlags.memoryRuntimeV1,
    policy_gate_v1: featureFlags.policyGateV1,
    shadow_model_v2: featureFlags.shadowModelV2,
  };
}

