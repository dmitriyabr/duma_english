import { SpeechMetrics } from "./scoring";
import { config } from "./config";

type SpeechAnalyzeOptions = {
  taskPrompt: string;
  taskType: string;
  durationSec?: number | null;
  meta?: {
    referenceText?: string;
    supportsPronAssessment?: boolean;
  };
};

type AzureNBestItem = {
  Display?: string;
  Confidence?: number;
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  ProsodyScore?: number;
  PronScore?: number;
  Words?: Array<{ Word?: string }>;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
    ProsodyScore?: number;
  };
};

export type AzureRecognitionResponse = {
  RecognitionStatus?: string;
  DisplayText?: string;
  Duration?: number;
  NBest?: AzureNBestItem[];
  [key: string]: unknown;
};

export type SpeechAnalysisResult = {
  transcript: string;
  metrics: SpeechMetrics;
  raw: unknown;
  provider: "mock" | "azure";
};

function estimateWavDurationSec(buffer: Buffer) {
  if (buffer.length < 44) return null;
  const byteRate = buffer.readUInt32LE(28);
  const dataLength = buffer.readUInt32LE(40);
  if (!byteRate || !dataLength) return null;
  return Number((dataLength / byteRate).toFixed(2));
}

const WAV_HEADER_SIZE = 44;

function splitWavBuffer(buffer: Buffer, chunkSeconds: number): Buffer[] {
  if (buffer.length < WAV_HEADER_SIZE) return [buffer];
  const byteRate = buffer.readUInt32LE(28);
  if (!byteRate) return [buffer];
  const totalDataLength = buffer.length - WAV_HEADER_SIZE;
  const chunkDataSize = byteRate * chunkSeconds;
  if (totalDataLength <= chunkDataSize) return [buffer];

  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < totalDataLength) {
    const sliceLen = Math.min(chunkDataSize, totalDataLength - offset);
    const chunk = Buffer.alloc(WAV_HEADER_SIZE + sliceLen);
    buffer.copy(chunk, 0, 0, WAV_HEADER_SIZE); // copy header
    buffer.copy(chunk, WAV_HEADER_SIZE, WAV_HEADER_SIZE + offset, WAV_HEADER_SIZE + offset + sliceLen);
    // patch RIFF file size (offset 4) = total file size - 8
    chunk.writeUInt32LE(chunk.length - 8, 4);
    // patch data chunk size (offset 40)
    chunk.writeUInt32LE(sliceLen, 40);
    chunks.push(chunk);
    offset += sliceLen;
  }
  return chunks;
}

function mergeChunkResults(
  results: { transcript: string; metrics: SpeechMetrics }[]
): { transcript: string; metrics: SpeechMetrics } {
  const transcript = results.map((r) => r.transcript).join(" ");
  const totalDuration = results.reduce((s, r) => s + (r.metrics.durationSec || 0), 0);
  const totalWords = results.reduce((s, r) => s + (r.metrics.wordCount || 0), 0);

  let weightedConfidence = 0;
  let confidenceDuration = 0;
  const paKeys = ["accuracy", "fluency", "completeness", "prosody", "pronunciation"] as const;
  const paWeighted: Record<string, number> = {};
  const paDuration: Record<string, number> = {};

  for (const r of results) {
    const dur = r.metrics.durationSec || 0;
    if (typeof r.metrics.confidence === "number") {
      weightedConfidence += r.metrics.confidence * dur;
      confidenceDuration += dur;
    }
    for (const k of paKeys) {
      if (typeof r.metrics[k] === "number") {
        paWeighted[k] = (paWeighted[k] || 0) + r.metrics[k]! * dur;
        paDuration[k] = (paDuration[k] || 0) + dur;
      }
    }
  }

  const metrics: SpeechMetrics = {
    durationSec: Number(totalDuration.toFixed(2)),
    wordCount: totalWords,
    speechRate: estimateSpeechRate(totalWords, totalDuration),
    fillerCount: countFillers(transcript),
    pauseCount: countPausesFromText(transcript),
    confidence: confidenceDuration > 0 ? Number((weightedConfidence / confidenceDuration).toFixed(4)) : undefined,
  };

  for (const k of paKeys) {
    if (paDuration[k] && paDuration[k] > 0) {
      (metrics as Record<string, unknown>)[k] = Number((paWeighted[k] / paDuration[k]).toFixed(2));
    }
  }

  return { transcript, metrics };
}

function countFillers(text: string) {
  const matches = text.match(/\b(um|uh|like|you know)\b/gi);
  return matches ? matches.length : 0;
}

function countPausesFromText(text: string) {
  const matches = text.match(/[,.!?;:]/g);
  return matches ? matches.length : 0;
}

function estimateSpeechRate(wordCount: number, durationSec: number) {
  if (!durationSec || durationSec <= 0) return 0;
  return Number(((wordCount / durationSec) * 60).toFixed(2));
}

function buildPronunciationHeader(referenceText: string) {
  const payload = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Dimension: "Comprehensive",
    EnableProsodyAssessment: "True",
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function isTransientAzureError(status: number) {
  return status === 429 || status >= 500;
}

async function callAzureRecognition(
  buffer: Buffer,
  options: SpeechAnalyzeOptions
): Promise<{ response: AzureRecognitionResponse; status: number }> {
  const key = config.speech.azureKey;
  const endpoint = config.speech.azureEndpoint;
  const region = config.speech.azureRegion;

  if (!key) {
    throw new Error("Azure Speech credentials are missing");
  }

  const endpointValue = (endpoint || "").trim();
  const isDirectSttHost = endpointValue.includes(".stt.speech.microsoft.com");
  const baseUrl = isDirectSttHost
    ? endpointValue.replace(/\/+$/, "")
    : `https://${region}.stt.speech.microsoft.com`;
  const url = `${baseUrl}/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": key,
    "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
    Accept: "application/json;text/xml",
  };

  const referenceText = options.meta?.supportsPronAssessment
    ? options.meta.referenceText
    : undefined;
  if (referenceText) {
    headers["Pronunciation-Assessment"] = buildPronunciationHeader(referenceText);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  console.log(
    JSON.stringify({
      event: "azure_request_sent",
      region,
      hasPronunciationAssessment: Boolean(referenceText),
    })
  );
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: new Uint8Array(buffer),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const bodyText = await res.text();
    const error = new Error(`Azure speech failed: ${res.status} ${bodyText.slice(0, 200)}`);
    (error as Error & { code?: string; status?: number }).code = "AZURE_HTTP_ERROR";
    (error as Error & { code?: string; status?: number }).status = res.status;
    throw error;
  }

  const json = (await res.json()) as AzureRecognitionResponse;
  console.log(
    JSON.stringify({
      event: "azure_response_received",
      status: res.status,
      recognitionStatus: json.RecognitionStatus,
      hasNBest: Array.isArray(json.NBest),
    })
  );
  return { response: json, status: res.status };
}

export function parseAzureResponseToMetrics(
  response: AzureRecognitionResponse,
  fallbackDurationSec: number,
  paMode: "none" | "target_ref" | "self_ref" = "none"
): { transcript: string; metrics: SpeechMetrics } {
  const best = response.NBest?.[0];
  const transcript = best?.Display || response.DisplayText || "";
  const wordCount =
    best?.Words?.length || transcript.trim().split(/\s+/).filter(Boolean).length || 0;
  const durationFromResponse = response.Duration ? response.Duration / 10_000_000 : 0;
  const durationSec =
    Number((durationFromResponse || fallbackDurationSec || 0).toFixed(2)) || fallbackDurationSec;
  const speechRate = estimateSpeechRate(wordCount, durationSec);

  const paAccuracy = best?.AccuracyScore ?? best?.PronunciationAssessment?.AccuracyScore;
  const paFluency = best?.FluencyScore ?? best?.PronunciationAssessment?.FluencyScore;
  const paCompleteness = best?.CompletenessScore ?? best?.PronunciationAssessment?.CompletenessScore;
  const paProsody = best?.ProsodyScore ?? best?.PronunciationAssessment?.ProsodyScore;
  const paPron = best?.PronScore ?? paAccuracy;

  return {
    transcript,
    metrics: {
      accuracy: paAccuracy,
      pronunciation: paPron,
      fluency: paFluency,
      completeness: paCompleteness,
      prosody: paProsody,
      pronunciationTargetRef: paMode === "target_ref" ? paPron : undefined,
      pronunciationSelfRef: paMode === "self_ref" ? paPron : undefined,
      confidence: best?.Confidence,
      speechRate,
      fillerCount: countFillers(transcript),
      pauseCount: countPausesFromText(transcript),
      durationSec,
      wordCount,
    },
  };
}

function normalizeTranscriptForReference(transcript: string) {
  return transcript
    .toLowerCase()
    .replace(/\b(um|uh|you know|like)\b/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function analyzeSpeechFromBuffer(
  buffer: Buffer,
  options: SpeechAnalyzeOptions
): Promise<SpeechAnalysisResult> {
  const provider = config.speech.provider;
  const fallbackDurationSec = options.durationSec || estimateWavDurationSec(buffer) || 0;

  if (provider === "mock") {
    const transcript = "test";
    return {
      transcript,
      metrics: {
        durationSec: fallbackDurationSec || undefined,
      },
      raw: null,
      provider: "mock",
    };
  }

  if (provider !== "azure") {
    throw new Error(`Unsupported SPEECH_PROVIDER: ${provider}`);
  }

  const CHUNK_SECONDS = 55;
  const audioDurationSec = estimateWavDurationSec(buffer) || 0;

  // Long audio: split into chunks, transcribe in parallel, merge results
  if (audioDurationSec > CHUNK_SECONDS) {
    const chunks = splitWavBuffer(buffer, CHUNK_SECONDS);
    console.log(JSON.stringify({ event: "audio_chunked", chunks: chunks.length, audioDurationSec }));
    const sttOptions: SpeechAnalyzeOptions = {
      ...options,
      meta: { ...options.meta, supportsPronAssessment: false, referenceText: undefined },
    };
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        const { response } = await callAzureRecognition(chunk, sttOptions);
        const chunkDuration = estimateWavDurationSec(chunk) || 0;
        return parseAzureResponseToMetrics(response, chunkDuration, "none");
      })
    );
    const merged = mergeChunkResults(chunkResults);

    // Self-ref PA on the first chunk using the merged transcript
    const enableSelfRefPa = config.speech.enableSelfRefPa;
    if (enableSelfRefPa) {
      const pseudoReference = normalizeTranscriptForReference(merged.transcript);
      if (pseudoReference.split(/\s+/).filter(Boolean).length >= 3) {
        const selfRefOptions: SpeechAnalyzeOptions = {
          ...options,
          meta: { supportsPronAssessment: true, referenceText: pseudoReference },
        };
        const { response: paResponse } = await callAzureRecognition(chunks[0], selfRefOptions);
        const paParsed = parseAzureResponseToMetrics(paResponse, estimateWavDurationSec(chunks[0]) || 0, "self_ref");
        merged.metrics.pronunciationSelfRef =
          paParsed.metrics.pronunciationSelfRef ?? paParsed.metrics.pronunciation ?? paParsed.metrics.accuracy;
        console.log(JSON.stringify({ event: "pa_detected", mode: "self_ref", taskType: options.taskType }));
      }
    }

    return {
      transcript: merged.transcript,
      metrics: merged.metrics,
      raw: { chunked: true, chunkCount: chunks.length },
      provider: "azure",
    };
  }

  // Short audio: single-call path (unchanged)
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const hasTargetReference =
        options.meta?.supportsPronAssessment && Boolean(options.meta.referenceText);
      const { response } = await callAzureRecognition(buffer, options);
      const parsed = parseAzureResponseToMetrics(
        response,
        fallbackDurationSec,
        hasTargetReference ? "target_ref" : "none"
      );
      const hasPa =
        typeof parsed.metrics.accuracy === "number" ||
        typeof parsed.metrics.fluency === "number" ||
        typeof parsed.metrics.completeness === "number" ||
        typeof parsed.metrics.prosody === "number" ||
        typeof parsed.metrics.pronunciation === "number";
      console.log(
        JSON.stringify({
          event: hasPa ? "pa_detected" : "pa_missing",
          mode: hasTargetReference ? "target_ref" : "none",
          taskType: options.taskType,
        })
      );

      const enableSelfRefPa = config.speech.enableSelfRefPa;
      if (!hasTargetReference && enableSelfRefPa) {
        const pseudoReference = normalizeTranscriptForReference(parsed.transcript);
        if (pseudoReference.split(/\s+/).filter(Boolean).length >= 3) {
          const selfRefOptions: SpeechAnalyzeOptions = {
            ...options,
            meta: { supportsPronAssessment: true, referenceText: pseudoReference },
          };
          const { response: paResponse } = await callAzureRecognition(buffer, selfRefOptions);
          const paParsed = parseAzureResponseToMetrics(paResponse, fallbackDurationSec, "self_ref");
          const mergedMetrics: SpeechMetrics = {
            ...parsed.metrics,
            pronunciationSelfRef:
              paParsed.metrics.pronunciationSelfRef ??
              paParsed.metrics.pronunciation ??
              paParsed.metrics.accuracy,
          };
          console.log(JSON.stringify({ event: "pa_detected", mode: "self_ref", taskType: options.taskType }));
          return {
            transcript: parsed.transcript,
            metrics: mergedMetrics,
            raw: { stt: response, selfRefPa: paResponse },
            provider: "azure",
          };
        }
      }

      return {
        transcript: parsed.transcript,
        metrics: parsed.metrics,
        raw: response,
        provider: "azure",
      };
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      if (attempt < 2 && status && isTransientAzureError(status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Azure analysis failed");
}
