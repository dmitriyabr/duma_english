import { NextResponse } from "next/server";
import { chatJson } from "@/lib/llm";
import { config } from "@/lib/config";

/**
 * GET /api/debug/langsmith-test
 * Делает один тестовый вызов LLM. Если tracing и LangSmith API key заданы,
 * этот run появится в LangSmith за несколько секунд.
 */
export async function GET() {
  const apiKey = config.openai.apiKey;
  const tracingFlag = config.langsmith.tracing;
  const tracingEnabled = tracingFlag === "true";
  const langsmithApiKey = config.langsmith.apiKey;
  const hasLangSmithKey = Boolean(langsmithApiKey);
  const project = config.langsmith.project || "default";

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set", tracingEnabled: false },
      { status: 503 }
    );
  }

  try {
    const content = await chatJson(
      "You are a test endpoint. Reply with valid JSON only.",
      "Reply with exactly: {\"ok\": true, \"source\": \"langsmith-test\"}",
      {
        openaiApiKey: apiKey,
        model: config.openai.model,
        temperature: 0,
        maxTokens: 50,
      }
    );

    return NextResponse.json({
      ok: true,
      responsePreview: content.slice(0, 200),
      langsmith: {
        tracingEnabled,
        apiKeySet: hasLangSmithKey,
        project,
        hint: tracingEnabled && hasLangSmithKey
          ? "Check https://smith.langchain.com — this run should appear in a few seconds."
          : "Set LANGSMITH_TRACING=true (or LANGCHAIN_TRACING_V2=true) and LANGSMITH_API_KEY (or LANGCHAIN_API_KEY) in .env, then restart and call this URL again.",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "LLM call failed",
        langsmith: { tracingEnabled, apiKeySet: hasLangSmithKey, project },
      },
      { status: 500 }
    );
  }
}
