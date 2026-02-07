/**
 * Shared LLM calls via LangChain. When LANGCHAIN_TRACING_V2=true and LANGCHAIN_API_KEY
 * are set, all runs appear in LangSmith for prompt/response debugging.
 *
 * @see https://docs.smith.langchain.com/observability/how_to_guides/trace_with_langchain
 */

function applyLangSmithEnvCompatibility() {
  const project = process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT;
  if (project) {
    process.env.LANGSMITH_PROJECT = project;
    process.env.LANGCHAIN_PROJECT = project;
  }

  const apiKey = process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
  if (apiKey) {
    process.env.LANGSMITH_API_KEY = apiKey;
    process.env.LANGCHAIN_API_KEY = apiKey;
  }

  const tracing = process.env.LANGSMITH_TRACING || process.env.LANGCHAIN_TRACING_V2;
  if (tracing) {
    process.env.LANGSMITH_TRACING = tracing;
    process.env.LANGCHAIN_TRACING_V2 = tracing;
  }

  const endpoint = process.env.LANGSMITH_ENDPOINT || process.env.LANGCHAIN_ENDPOINT;
  if (endpoint) {
    process.env.LANGSMITH_ENDPOINT = endpoint;
    process.env.LANGCHAIN_ENDPOINT = endpoint;
  }
}

export type ChatJsonOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

/**
 * Call OpenAI chat with system + user message and request JSON object response.
 * Returns the raw content string. When LangSmith is enabled, the run is traced
 * (prompts, response, latency) at https://smith.langchain.com
 */
export async function chatJson(
  systemContent: string,
  userContent: string,
  options: ChatJsonOptions & { openaiApiKey: string }
): Promise<string> {
  applyLangSmithEnvCompatibility();
  const [{ ChatOpenAI }, { HumanMessage, SystemMessage }] = await Promise.all([
    import("@langchain/openai"),
    import("@langchain/core/messages"),
  ]);
  const model = new ChatOpenAI({
    modelName: options.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens ?? 700,
    openAIApiKey: options.openaiApiKey,
  });

  const messages = [
    new SystemMessage(systemContent),
    new HumanMessage(userContent),
  ];

  const response = await model.invoke(messages, {
    response_format: { type: "json_object" as const },
    runName: options.runName,
    tags: options.tags,
    metadata: {
      ...options.metadata,
      langsmithProject: process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT || null,
    },
  });

  const content = typeof response.content === "string" ? response.content : String(response.content);
  return content;
}

export type EmbedTextsOptions = {
  model?: string;
  dimensions?: number;
};

export async function embedTexts(
  texts: string[],
  options: EmbedTextsOptions & { openaiApiKey: string }
): Promise<number[][]> {
  if (texts.length === 0) return [];
  applyLangSmithEnvCompatibility();
  const { OpenAIEmbeddings } = await import("@langchain/openai");
  const embeddings = new OpenAIEmbeddings({
    apiKey: options.openaiApiKey,
    model: options.model || process.env.GSE_EMBEDDING_MODEL || "text-embedding-3-small",
    dimensions: options.dimensions,
  });
  const vectors = await embeddings.embedDocuments(texts);
  return vectors as number[][];
}
