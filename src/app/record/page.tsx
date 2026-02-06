"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type TaskResponse = {
  taskId: string;
  prompt: string;
  assessmentMode: "pa" | "stt";
  maxDurationSec: number;
  constraints: { minSeconds: number; maxSeconds: number };
};

function flattenChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function downsampleTo16k(input: Float32Array, sourceRate: number) {
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const newLength = Math.round(input.length / ratio);
  const output = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < output.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accum += input[i];
      count += 1;
    }
    output[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return output;
}

function floatTo16BitPCM(float32: Float32Array) {
  const output = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function encodeWav(pcm16: Int16Array, sampleRate: number) {
  const dataLength = pcm16.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

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
  for (let i = 0; i < pcm16.length; i += 1) {
    view.setInt16(offset, pcm16[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export default function RecordPage() {
  const router = useRouter();
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const maxDurationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("currentTask");
    if (stored) {
      setTask(JSON.parse(stored));
    }
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (status === "Recording") {
      timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      cleanupAudioGraph();
    };
  }, []);

  function cleanupAudioGraph() {
    if (maxDurationTimeoutRef.current) {
      window.clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close().catch(() => undefined);

    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }

  async function startRecording() {
    setError(null);
    setSeconds(0);
    chunksRef.current = [];

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Recording is not supported in this browser.");
      }
      if (!window.AudioContext) {
        throw new Error("AudioContext is not available.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(channelData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      processorRef.current = processor;
      setStatus("Recording");

      const maxDurationSec = task?.maxDurationSec ?? 60;
      maxDurationTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, maxDurationSec * 1000);
    } catch (e) {
      cleanupAudioGraph();
      setError(e instanceof Error ? e.message : "Microphone access denied.");
    }
  }

  async function stopRecording() {
    if (status !== "Recording") return;
    setStatus("Uploading");

    const audioContext = audioContextRef.current;
    const chunks = chunksRef.current.slice();
    cleanupAudioGraph();

    if (!audioContext || chunks.length === 0) {
      setError("No audio captured. Please record again.");
      setStatus("Idle");
      return;
    }

    const merged = flattenChunks(chunks);
    const downsampled = downsampleTo16k(merged, audioContext.sampleRate);
    const pcm16 = floatTo16BitPCM(downsampled);
    const wavBlob = encodeWav(pcm16, 16000);
    const durationSec = Number((downsampled.length / 16000).toFixed(2));

    await uploadRecording(wavBlob, durationSec);
  }

  async function uploadRecording(blob: Blob, durationSec: number) {
    if (!task) {
      setError("Missing task.");
      setStatus("Idle");
      return;
    }

    if (durationSec <= 0) {
      setError("Empty recording. Please try again.");
      setStatus("Idle");
      return;
    }

    if (durationSec > task.maxDurationSec) {
      setError(`Recording too long. Max ${task.maxDurationSec}s for this task.`);
      setStatus("Idle");
      return;
    }

    try {
      const attemptResponse = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.taskId,
          contentType: "audio/wav",
          durationSec,
        }),
      });
      if (!attemptResponse.ok) {
        const payload = (await attemptResponse.json()) as { error?: string };
        throw new Error(payload.error || "Failed to create attempt");
      }
      const { attemptId } = (await attemptResponse.json()) as { attemptId: string };

      const uploadRes = await fetch(`/api/attempts/${attemptId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: blob,
      });
      if (!uploadRes.ok) {
        const payload = (await uploadRes.json()) as { error?: string };
        throw new Error(payload.error || "Upload failed");
      }

      localStorage.setItem("lastAttemptId", attemptId);
      router.push(`/results?attemptId=${attemptId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setStatus("Idle");
    }
  }

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Duma Trainer</strong>
        <div className="nav-links">
          <Link href="/task">Task</Link>
          <Link href="/home">Home</Link>
        </div>
      </nav>
      <section className="container">
        <div className="card">
          <h1 className="title">Record your answer</h1>
          {task ? (
            <>
              <p className="subtitle">{task.prompt}</p>
              <p className="subtitle">
                Mode: {task.assessmentMode.toUpperCase()} | Max {task.maxDurationSec}s
              </p>
            </>
          ) : (
            <p className="subtitle">
              No task loaded. Go back to <Link href="/task">Task</Link>.
            </p>
          )}
          <div className="spacer" />
          <div className="status">
            <span className="status-dot" />
            {status} - {seconds}s
          </div>
          <div className="spacer" />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn" onClick={startRecording} disabled={status === "Recording"}>
              Start
            </button>
            <button className="btn ghost" onClick={stopRecording} disabled={status !== "Recording"}>
              Stop
            </button>
          </div>
          {error && <p style={{ color: "#c1121f", marginTop: 12 }}>{error}</p>}
        </div>
      </section>
    </div>
  );
}
