"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Phase =
  | "starting"
  | "task"
  | "recording"
  | "uploading"
  | "processing"
  | "feedback"
  | "submitting"
  | "done";

type TaskInfo = {
  taskId: string;
  type: string;
  prompt: string;
  metaJson: Record<string, unknown>;
};

type AttemptResult = {
  status: string;
  results?: {
    transcript?: string | null;
    scores?: {
      overallScore?: number | null;
      speechScore?: number | null;
      taskScore?: number | null;
    } | null;
  } | null;
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

const MAX_ATTEMPTS = 6;

export default function PlacementExtendedPage() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [doneReason, setDoneReason] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const maxDurationTimeoutRef = useRef<number | null>(null);
  const pollActiveRef = useRef(true);

  // Start session on mount
  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const res = await fetch("/api/placement/extended/start", { method: "POST" });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error((payload as { error?: string }).error || "Failed to start placement");
        }
        const data = await res.json();
        if (!active) return;
        setSessionId(data.sessionId);
        setTask(data.task);
        const meta = data.task.metaJson || {};
        setAttemptNumber(typeof meta.placementAttemptNumber === "number" ? meta.placementAttemptNumber : 1);
        setPhase("task");
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to start placement");
      }
    }
    start();
    return () => { active = false; };
  }, []);

  // Recording timer
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (phase === "recording") {
      timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [phase]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { cleanupAudioGraph(); };
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
      setPhase("recording");

      maxDurationTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, 300 * 1000);
    } catch (e) {
      cleanupAudioGraph();
      setError(e instanceof Error ? e.message : "Microphone access denied.");
    }
  }

  async function stopRecording() {
    if (phase !== "recording") return;
    setPhase("uploading");

    const audioContext = audioContextRef.current;
    const chunks = chunksRef.current.slice();
    cleanupAudioGraph();

    if (!audioContext || chunks.length === 0) {
      setError("No audio captured. Please record again.");
      setPhase("task");
      return;
    }

    const merged = flattenChunks(chunks);
    const downsampled = downsampleTo16k(merged, audioContext.sampleRate);
    const pcm16 = floatTo16BitPCM(downsampled);
    const wavBlob = encodeWav(pcm16, 16000);
    const durationSec = Number((downsampled.length / 16000).toFixed(2));

    if (durationSec <= 0 || !task) {
      setError("Empty recording. Please try again.");
      setPhase("task");
      return;
    }

    try {
      const attemptRes = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.taskId,
          contentType: "audio/wav",
          durationSec,
        }),
      });
      if (!attemptRes.ok) {
        const payload = await attemptRes.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error || "Failed to create attempt");
      }
      const { attemptId: newAttemptId } = (await attemptRes.json()) as { attemptId: string };

      const uploadRes = await fetch(`/api/attempts/${newAttemptId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wavBlob,
      });
      if (!uploadRes.ok) {
        const payload = await uploadRes.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error || "Upload failed");
      }

      setAttemptId(newAttemptId);
      setPhase("processing");
      pollAttempt(newAttemptId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setPhase("task");
    }
  }

  function pollAttempt(id: string) {
    pollActiveRef.current = true;
    async function poll() {
      if (!pollActiveRef.current) return;
      try {
        const res = await fetch(`/api/attempts/${id}`);
        if (!res.ok) throw new Error("Unable to fetch results");
        const json: AttemptResult = await res.json();
        if (!pollActiveRef.current) return;
        if (json.status === "completed" || json.status === "failed") {
          setAttemptResult(json);
          setPhase("feedback");
        } else {
          setTimeout(poll, 2000);
        }
      } catch {
        if (!pollActiveRef.current) return;
        setTimeout(poll, 3000);
      }
    }
    poll();
  }

  async function submitFeedback(feedback: "too_easy" | "just_right" | "too_hard") {
    if (!sessionId || !attemptId) return;
    setPhase("submitting");
    setError(null);

    try {
      const res = await fetch(`/api/placement/extended/${sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, userFeedback: feedback }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error || "Submit failed");
      }
      const data = await res.json();

      if (data.finished) {
        setDoneReason(data.reason || "Placement complete");
        setPhase("done");
      } else {
        setTask(data.nextTask);
        setAttemptNumber((n) => n + 1);
        setAttemptId(null);
        setAttemptResult(null);
        setPhase("task");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
      setPhase("feedback");
    }
  }

  async function resetPlacement() {
    if (!confirm("Start over? Current progress will be lost.")) return;
    setError(null);
    pollActiveRef.current = false;
    cleanupAudioGraph();
    try {
      const res = await fetch("/api/placement/extended/reset", { method: "POST" });
      if (!res.ok) throw new Error("Reset failed");
    } catch {
      // even if reset call fails, reload to retry
    }
    window.location.reload();
  }

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { pollActiveRef.current = false; };
  }, []);

  const progressDots = Array.from({ length: MAX_ATTEMPTS }, (_, i) => i + 1);

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Duma Trainer</strong>
        <div className="nav-links">
          <Link href="/home">Home</Link>
        </div>
      </nav>
      <section className="container">
        <div className="card">
          <h1 className="title">Placement Test</h1>

          {/* Progress indicator */}
          {phase !== "done" && phase !== "starting" && (
            <>
              <p className="subtitle">Attempt {attemptNumber} of {MAX_ATTEMPTS}</p>
              <div style={{ display: "flex", gap: 8, margin: "8px 0 16px" }}>
                {progressDots.map((n) => (
                  <div
                    key={n}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: n < attemptNumber ? "#2d6a4f" : n === attemptNumber ? "#40916c" : "#ddd",
                      border: n === attemptNumber ? "2px solid #1b4332" : "none",
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {/* Starting phase */}
          {phase === "starting" && !error && (
            <p className="subtitle">Starting placement test...</p>
          )}

          {/* Task phase */}
          {phase === "task" && task && (
            <>
              <p className="subtitle">{task.prompt}</p>
              <p className="subtitle" style={{ fontSize: "0.85rem", opacity: 0.7 }}>
                Speak freely for up to 5 minutes. There are no wrong answers.
              </p>
              <div className="spacer" />
              <button className="btn" onClick={startRecording}>
                Start recording
              </button>
            </>
          )}

          {/* Recording phase */}
          {phase === "recording" && (
            <>
              <div className="status">
                <span className="status-dot" />
                Recording - {seconds}s
              </div>
              <div className="spacer" />
              <button className="btn ghost" onClick={stopRecording}>
                Stop recording
              </button>
            </>
          )}

          {/* Uploading phase */}
          {phase === "uploading" && (
            <p className="subtitle">Uploading your recording...</p>
          )}

          {/* Processing phase */}
          {phase === "processing" && (
            <p className="subtitle">Processing your recording...</p>
          )}

          {/* Feedback phase */}
          {phase === "feedback" && attemptResult && (
            <>
              {attemptResult.status === "failed" && (
                <p className="subtitle" style={{ color: "#c1121f" }}>
                  Processing failed. Your response was still recorded.
                </p>
              )}
              {attemptResult.results?.transcript && (
                <div className="metric">
                  <span>Transcript</span>
                  <p className="subtitle">{attemptResult.results.transcript}</p>
                </div>
              )}
              {attemptResult.results?.scores?.overallScore != null && (
                <div className="metric">
                  <span>Score</span>
                  <strong>{Math.round(attemptResult.results.scores.overallScore)}</strong>
                </div>
              )}
              <div className="spacer" />
              <p className="subtitle">How did that feel?</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button className="btn ghost" onClick={() => submitFeedback("too_easy")}>
                  Too easy
                </button>
                <button className="btn" onClick={() => submitFeedback("just_right")}>
                  Just right
                </button>
                <button className="btn ghost" onClick={() => submitFeedback("too_hard")}>
                  Too hard
                </button>
              </div>
            </>
          )}

          {/* Submitting phase */}
          {phase === "submitting" && (
            <p className="subtitle">Submitting...</p>
          )}

          {/* Done phase */}
          {phase === "done" && (
            <>
              <p className="subtitle">Placement test complete!</p>
              <div className="metric">
                <span>Attempts completed</span>
                <strong>{attemptNumber}</strong>
              </div>
              {doneReason && (
                <div className="metric">
                  <span>Reason</span>
                  <p className="subtitle">{doneReason}</p>
                </div>
              )}
              <div className="spacer" />
              <Link className="btn" href="/home">
                Continue to home
              </Link>
            </>
          )}

          {/* Error display */}
          {error && <p style={{ color: "#c1121f", marginTop: 12 }}>{error}</p>}

          {/* Reset button */}
          {phase !== "starting" && phase !== "done" && (
            <button
              className="btn ghost"
              style={{ marginTop: 24, fontSize: "0.85rem", opacity: 0.7 }}
              onClick={resetPlacement}
            >
              Start over
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
