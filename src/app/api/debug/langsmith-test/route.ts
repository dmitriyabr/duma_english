import { NextResponse } from "next/server";
import { chatJson } from "@/lib/llm";

/**
 * GET /api/debug/langsmith-test
 * Делает один тестовый вызов LLM. Если LANGCHAIN_TRACING_V2=true и LANGCHAIN_API_KEY задан,
 * этот run появится в LangSmith за несколько секунд.
 */
export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  const tracingV2 = process.env.LANGCHAIN_TRACING_V2 === "true";
  const hasLangSmithKey = Boolean(process.env.LANGCHAIN_API_KEY);

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
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        maxTokens: 50,
      }
    );

    return NextResponse.json({
      ok: true,
      responsePreview: content.slice(0, 200),
      langsmith: {
        tracingEnabled: tracingV2,
        apiKeySet: hasLangSmithKey,
        hint: tracingV2 && hasLangSmithKey
          ? "Check https://smith.langchain.com — this run should appear in a few seconds."
          : "Set LANGCHAIN_TRACING_V2=true and LANGCHAIN_API_KEY in .env, then restart and call this URL again.",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "LLM call failed",
        langsmith: { tracingEnabled: tracingV2, apiKeySet: hasLangSmithKey },
      },
      { status: 500 }
    );
  }
}
