/**
 * Shared LLM calls via LangChain. When LANGCHAIN_TRACING_V2=true and LANGCHAIN_API_KEY
 * are set, all runs appear in LangSmith for prompt/response debugging.
 *
 * @see https://docs.smith.langchain.com/observability/how_to_guides/trace_with_langchain
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export type ChatJsonOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
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
  });

  const content = typeof response.content === "string" ? response.content : String(response.content);
  return content;
}
