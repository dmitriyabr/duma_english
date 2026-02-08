import { createHash } from "crypto";
import { appendPipelineDebugEvent, previewText } from "@/lib/pipelineDebugLog";

export type LemmaToken = {
  text: string;
  lemma: string;
  pos: string;
  start: number;
  end: number;
};

export type LemmatizeResponse = {
  language: string;
  model: string;
  tokens: LemmaToken[];
};

function sha1(value: string) {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "").trim();
}

function toLemmaFallback(token: string) {
  const word = normalizeWord(token);
  if (word.length <= 2) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

function lemmatizeFallback(text: string): LemmatizeResponse {
  const tokens: LemmaToken[] = [];
  const re = /[A-Za-z']+/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0] || "";
    const start = typeof m.index === "number" ? m.index : 0;
    const end = start + raw.length;
    tokens.push({
      text: raw,
      lemma: toLemmaFallback(raw),
      pos: "X",
      start,
      end,
    });
  }
  return { language: "en", model: "fallback", tokens };
}

const cache = new Map<string, LemmatizeResponse>();

export async function lemmatizeEnglish(text: string, opts?: { taskType?: string; runId?: string }) {
  const input = String(text || "");
  const key = `${sha1(input)}:${input.length}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const baseUrl = (process.env.LEMMA_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    const fallback = lemmatizeFallback(input);
    cache.set(key, fallback);
    return fallback;
  }

  const url = `${baseUrl}/lemmatize`;
  const timeoutMs = Number(process.env.LEMMA_SERVICE_TIMEOUT_MS || 1200);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));

  await appendPipelineDebugEvent({
    event: "lemma_service_request",
    taskType: opts?.taskType || null,
    runId: opts?.runId || null,
    url,
    textPreview: previewText(input, 600),
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: input }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const status = res.status;
    if (!res.ok) throw new Error(`lemma_service_http_${status}`);
    const json = (await res.json()) as LemmatizeResponse;
    const out: LemmatizeResponse = {
      language: String((json as { language?: unknown }).language || "en"),
      model: String((json as { model?: unknown }).model || "unknown"),
      tokens: Array.isArray((json as { tokens?: unknown }).tokens)
        ? ((json as { tokens: unknown[] }).tokens as unknown[]).map((t) => {
            const row = (t || {}) as Record<string, unknown>;
            return {
              text: String(row.text || ""),
              lemma: normalizeWord(String(row.lemma || "")) || normalizeWord(String(row.text || "")),
              pos: String(row.pos || "X"),
              start: Number(row.start || 0),
              end: Number(row.end || 0),
            } satisfies LemmaToken;
          })
        : [],
    };
    await appendPipelineDebugEvent({
      event: "lemma_service_response",
      taskType: opts?.taskType || null,
      runId: opts?.runId || null,
      model: out.model,
      tokenCount: out.tokens.length,
      top: out.tokens.slice(0, 12),
    });
    cache.set(key, out);
    return out;
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    await appendPipelineDebugEvent({
      event: "lemma_service_error",
      taskType: opts?.taskType || null,
      runId: opts?.runId || null,
      errorMessage: message,
    });
    const fallback = lemmatizeFallback(input);
    cache.set(key, fallback);
    return fallback;
  }
}
