import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  buildListeningRuntimePayload,
  parseListeningRuntimeMeta,
} from "@/lib/listening/runtime";

type AssetRouteContext = {
  params: Promise<{ assetId: string }>;
};

type CachedAudio = {
  expiresAt: number;
  mimeType: string;
  bytes: Uint8Array;
};

const AUDIO_CACHE_TTL_MS = 30 * 60 * 1000;
const audioCache = new Map<string, CachedAudio>();

function estimateToneDurationSec(text: string) {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(4, Math.min(45, Math.round(words * 0.45 + 1)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createToneWav(durationSec: number): Uint8Array {
  const sampleRate = 16000;
  const samples = Math.floor(clamp(durationSec, 1, 60) * sampleRate);
  const pcm = new Int16Array(samples);

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const freq = 420 + Math.sin(t * 2.4) * 120;
    const gate = Math.sin(2 * Math.PI * 1.7 * t) > 0 ? 1 : 0.15;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.25 * gate;
    pcm[i] = Math.round(sample * 32767);
  }

  const dataLength = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const sample of pcm) {
    view.setInt16(offset, sample, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function toAudioBody(bytes: Uint8Array, mimeType: string) {
  const normalized = new Uint8Array(bytes.byteLength);
  normalized.set(bytes);
  return new Blob([normalized.buffer], { type: mimeType });
}

function azureSpeechSynthesisUrl() {
  const endpointValue = (config.speech.azureEndpoint || "").trim();
  if (endpointValue.includes(".tts.speech.microsoft.com")) {
    return `${endpointValue.replace(/\/+$/, "")}/cognitiveservices/v1`;
  }
  return `https://${config.speech.azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

async function synthesizeWithAzure(text: string) {
  const key = config.speech.azureKey;
  if (!key) return null;

  const ssml = `<speak version='1.0' xml:lang='en-US'><voice xml:lang='en-US' name='en-US-AriaNeural'>${escapeXml(
    text,
  )}</voice></speak>`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(azureSpeechSynthesisUrl(), {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
      },
      body: ssml,
      signal: controller.signal,
    });

    if (!res.ok) return null;

    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: "audio/wav",
    } as const;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeWithOpenAi(text: string) {
  const apiKey = config.openai.apiKey;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
        response_format: "wav",
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: "audio/wav",
    } as const;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(_: Request, context: AssetRouteContext) {
  const { assetId } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cacheKey = assetId.trim();
  const cached = audioCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new NextResponse(toAudioBody(cached.bytes, cached.mimeType), {
      headers: {
        "Content-Type": cached.mimeType,
        "Cache-Control": "private, max-age=1800",
      },
    });
  }

  const task = await prisma.task.findFirst({
    where: {
      id: cacheKey,
      type: "listening_comprehension",
      taskInstance: {
        is: {
          studentId: student.studentId,
        },
      },
    },
    select: {
      id: true,
      prompt: true,
      metaJson: true,
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Listening asset not found" }, { status: 404 });
  }

  const parsedMeta = parseListeningRuntimeMeta(task.metaJson);
  const runtime = parsedMeta
    ? {
        hiddenScript: parsedMeta.script,
      }
    : buildListeningRuntimePayload({
        taskId: task.id,
        prompt: task.prompt,
        taskMeta:
          task.metaJson && typeof task.metaJson === "object" && !Array.isArray(task.metaJson)
            ? (task.metaJson as Record<string, unknown>)
            : null,
      });

  const script = parsedMeta?.script || runtime.hiddenScript;
  if (!script || script.trim().length === 0) {
    return NextResponse.json({ error: "Listening script unavailable" }, { status: 404 });
  }

  const synthesisText = script.slice(0, 1200);
  const azureAudio = await synthesizeWithAzure(synthesisText);
  const openAiAudio = azureAudio ? null : await synthesizeWithOpenAi(synthesisText);
  const audio =
    azureAudio ||
    openAiAudio || {
      bytes: createToneWav(estimateToneDurationSec(synthesisText)),
      mimeType: "audio/wav",
    };

  audioCache.set(cacheKey, {
    expiresAt: Date.now() + AUDIO_CACHE_TTL_MS,
    mimeType: audio.mimeType,
    bytes: audio.bytes,
  });

  return new NextResponse(toAudioBody(audio.bytes, audio.mimeType), {
    headers: {
      "Content-Type": audio.mimeType,
      "Cache-Control": "private, max-age=1800",
    },
  });
}
