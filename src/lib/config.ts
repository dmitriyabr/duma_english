import path from "node:path";

function readString(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = readString(name);
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid boolean env ${name}: expected "true" or "false", got "${value}"`);
}

function readNumber(name: string, fallback: number): number {
  const value = readString(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env ${name}: got "${value}"`);
  }
  return parsed;
}

function readCsv(name: string): string[] {
  const value = readString(name);
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  get nodeEnv() {
    return process.env.NODE_ENV || "development";
  },
  get isProduction() {
    return config.nodeEnv === "production";
  },
  auth: {
    get sessionTtlDays() {
      return readNumber("SESSION_TTL_DAYS", 120);
    },
    get sessionSecret() {
      return readString("SESSION_SECRET");
    },
  },
  admin: {
    get user() {
      return readString("ADMIN_USER") || "admin";
    },
    get pass() {
      return readString("ADMIN_PASS") || "changeme";
    },
  },
  github: {
    get token() {
      return readString("GITHUB_TOKEN");
    },
  },
  openai: {
    get apiKey() {
      return readString("OPENAI_API_KEY");
    },
    get model() {
      return readString("OPENAI_MODEL") || "gpt-4.1-mini";
    },
  },
  worker: {
    get pollIntervalMs() {
      return readNumber("WORKER_POLL_INTERVAL_MS", 3000);
    },
    get strictReliabilityGating() {
      return readBoolean("STRICT_RELIABILITY_GATING", false);
    },
    get showAiDebug() {
      return readBoolean("SHOW_AI_DEBUG", false);
    },
  },
  speech: {
    get provider() {
      return readString("SPEECH_PROVIDER") || "mock";
    },
    get azureKey() {
      return readString("AZURE_SPEECH_KEY");
    },
    get azureEndpoint() {
      return readString("AZURE_SPEECH_ENDPOINT");
    },
    get azureRegion() {
      return readString("AZURE_SPEECH_REGION") || "southafricanorth";
    },
    get enableSelfRefPa() {
      return readBoolean("ENABLE_SELF_REF_PA", false);
    },
  },
  storage: {
    get endpoint() {
      return readString("S3_ENDPOINT");
    },
    get region() {
      return readString("S3_REGION") || "auto";
    },
    get accessKeyId() {
      return readString("S3_ACCESS_KEY_ID");
    },
    get secretAccessKey() {
      return readString("S3_SECRET_ACCESS_KEY");
    },
    get bucket() {
      return readString("S3_BUCKET");
    },
    get publicBaseUrl() {
      return readString("S3_PUBLIC_BASE_URL");
    },
  },
  pipelineDebug: {
    get enabled() {
      return readBoolean("PIPELINE_DEBUG_LOG_ENABLED", false);
    },
    get path() {
      return readString("PIPELINE_DEBUG_LOG_PATH") || path.join(process.cwd(), "tmp", "pipeline-debug.ndjson");
    },
  },
  langsmith: {
    get project() {
      return readString("LANGSMITH_PROJECT") || readString("LANGCHAIN_PROJECT");
    },
    get apiKey() {
      return readString("LANGSMITH_API_KEY") || readString("LANGCHAIN_API_KEY");
    },
    get tracing() {
      return readString("LANGSMITH_TRACING") || readString("LANGCHAIN_TRACING_V2");
    },
    get endpoint() {
      return readString("LANGSMITH_ENDPOINT") || readString("LANGCHAIN_ENDPOINT");
    },
  },
  gse: {
    get embeddingModel() {
      return readString("GSE_EMBEDDING_MODEL") || "text-embedding-3-small";
    },
    get parserModel() {
      return readString("GSE_PARSER_MODEL") || config.openai.model;
    },
    get semanticEnabled() {
      return readBoolean("GSE_SEMANTIC_ENABLED", true);
    },
    get semanticMaxCandidates() {
      return readNumber("GSE_SEMANTIC_MAX_CANDIDATES", 24);
    },
    get vocabEnabled() {
      return readBoolean("GSE_VOCAB_ENABLED", true);
    },
    get vocabCatalogs() {
      return readCsv("GSE_VOCAB_CATALOGS");
    },
    get vocabIndexTtlMs() {
      return readNumber("GSE_VOCAB_INDEX_TTL_MS", 10 * 60 * 1000);
    },
    get vocabMaxCandidates() {
      return readNumber("GSE_VOCAB_MAX_CANDIDATES", 24);
    },
  },
  lemma: {
    get serviceUrl() {
      return readString("LEMMA_SERVICE_URL");
    },
    get timeoutMs() {
      return readNumber("LEMMA_SERVICE_TIMEOUT_MS", 1200);
    },
  },
};
