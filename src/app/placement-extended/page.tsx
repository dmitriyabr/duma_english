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

type DomainStageInfo = {
  stage: string;
  confidence: number;
};

type PlacementResult = {
  stage: string;
  confidence: number;
  domainStages?: {
    vocab: DomainStageInfo;
    grammar: DomainStageInfo;
    communication: DomainStageInfo;
  };
  pronunciationScore?: number | null;
};

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

type BusyPhase = "uploading" | "processing" | "submitting";
type ProcessingGameTarget = {
  id: number;
  x: number;
  y: number;
  emoji: string;
  points: number;
};

const PROCESSING_GAME_ICONS = [
  { emoji: "⭐", points: 1 },
  { emoji: "✨", points: 1 },
  { emoji: "🎈", points: 1 },
  { emoji: "🪄", points: 2 },
  { emoji: "💎", points: 2 },
] as const;

function createProcessingGameTarget(seed: number): ProcessingGameTarget {
  const pick = PROCESSING_GAME_ICONS[Math.floor(Math.random() * PROCESSING_GAME_ICONS.length)];
  return {
    id: Date.now() + seed,
    x: 8 + Math.random() * 84,
    y: 14 + Math.random() * 72,
    emoji: pick.emoji,
    points: pick.points,
  };
}

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

const STAGE_PROGRESS: Record<string, number> = {
  A0: 5, A1: 20, A2: 35, B1: 50, B2: 65, C1: 80, C2: 95,
};

function DomainBar({ label, stage }: { label: string; stage: string }) {
  const pct = STAGE_PROGRESS[stage] ?? 50;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "0.9rem" }}>
      <span style={{ width: 120, color: "#555", textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, height: 10, background: "#eee", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#40916c", borderRadius: 5 }} />
      </div>
      <span style={{ width: 28, fontWeight: 600, color: "#2d6a4f" }}>{stage}</span>
    </div>
  );
}

function stageLabel(stage: string) {
  if (stage === "A0") return "Beginner";
  if (stage === "A1") return "Elementary";
  if (stage === "A2") return "Pre-Intermediate";
  if (stage === "B1") return "Intermediate";
  if (stage === "B2") return "Upper-Intermediate";
  if (stage === "C1") return "Advanced";
  if (stage === "C2") return "Proficient";
  return "";
}

export default function PlacementExtendedPage() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [placementResult, setPlacementResult] = useState<PlacementResult | null>(null);
  const [busyHintIndex, setBusyHintIndex] = useState(0);
  const [gameScore, setGameScore] = useState(0);
  const [gameBest, setGameBest] = useState(0);
  const [gameTarget, setGameTarget] = useState<ProcessingGameTarget | null>(null);

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

  // Reset timer whenever a task screen is shown (including next attempt task).
  useEffect(() => {
    if (phase === "task") setSeconds(0);
  }, [phase, task?.taskId]);

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
        if (data.result) setPlacementResult(data.result);
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
  const timerLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const busyPhase: BusyPhase | null =
    phase === "uploading" || phase === "processing" || phase === "submitting" ? phase : null;
  const isBusy = Boolean(busyPhase);
  const busyHints: Record<BusyPhase, string[]> = {
    uploading: [
      "Packing your brave voice into a magic file...",
      "Sending your answer to the feedback castle...",
      "Keeping every word safe and clear...",
      "Adding sparkle so your audio sounds crisp...",
      "Building your speaking snapshot...",
      "Almost there, your quest upload is flying...",
    ],
    processing: [
      "Listening for your best phrases...",
      "Checking fluency, grammar, and vocabulary power...",
      "Preparing your next quest challenge...",
      "Matching your speech to level clues...",
      "Spotting your strongest speaking superpowers...",
      "Crafting helpful feedback for your next round...",
    ],
    submitting: [
      "Saving your quest result...",
      "Updating your level map...",
      "Almost done. Final sparkle!",
      "Writing your progress into the adventure log...",
      "Finishing the score card...",
      "Locking in your next mission...",
    ],
  };

  useEffect(() => {
    if (!busyPhase) {
      setBusyHintIndex(0);
      return;
    }
    const timer = setInterval(() => setBusyHintIndex((i) => i + 1), 3600);
    return () => clearInterval(timer);
  }, [busyPhase]);

  useEffect(() => {
    if (!isBusy) {
      setGameTarget(null);
      setGameScore(0);
      return;
    }
    setGameScore(0);
    setGameTarget(createProcessingGameTarget(0));
    const gameTimer = window.setInterval(() => {
      setGameTarget(createProcessingGameTarget(Math.floor(Math.random() * 10000)));
    }, 2200);
    return () => window.clearInterval(gameTimer);
  }, [isBusy]);

  function hitProcessingGameTarget() {
    if (!isBusy || !gameTarget) return;
    const gained = gameTarget.points;
    setGameScore((prev) => {
      const next = prev + gained;
      setGameBest((best) => (next > best ? next : best));
      return next;
    });
    setGameTarget(createProcessingGameTarget(gameTarget.id + 1));
  }

  return (
    <div className="page task-page placement-page">
      <section className="task-hero placement-hero">
        <div className="task-mobile-frame placement-frame">
          <div className="placement-floating-star" aria-hidden>
            ✦
          </div>
          <div className="placement-floating-cloud" aria-hidden />

          <div className="task-top-row">
            <div className="task-nav-mini">
              <Link href="/home">Home</Link>
              <Link href="/task">Task</Link>
            </div>
          </div>

          <p className="task-kicker placement-kicker">🧭 PLACEMENT QUEST</p>
          <h1 className="task-title-main">Let&apos;s find your level!</h1>
          <h2 className="task-title-accent placement-title-accent">Quick speaking adventure</h2>

          <div className="placement-shell">
            {phase !== "done" && phase !== "starting" && (
              <div className="placement-progress">
                <p className="placement-progress-label">
                  Attempt {attemptNumber} of {MAX_ATTEMPTS}
                </p>
                <div className="placement-progress-dots">
                  {progressDots.map((n) => {
                    const dotState =
                      n < attemptNumber ? "done" : n === attemptNumber ? "current" : "idle";
                    return <span key={n} className={`placement-progress-dot ${dotState}`} />;
                  })}
                </div>
              </div>
            )}

            {phase === "starting" && !error && (
              <section className="placement-panel">
                <p className="placement-loading-title">Starting placement test...</p>
                <p className="placement-note">Preparing your first speaking quest.</p>
              </section>
            )}

            {(phase === "task" || phase === "recording") && task && (
              <section className={`placement-panel ${phase === "recording" ? "placement-task-live" : ""}`}>
                <p className="placement-panel-kicker">YOUR SPEAKING MISSION</p>
                <p className="placement-prompt">{task.prompt}</p>
                <div className={`placement-live-controls ${phase === "recording" ? "is-recording" : ""}`}>
                  <p className="placement-live-label">{phase === "recording" ? "RECORDING NOW" : "TIMER"}</p>
                  <p className="placement-recording-timer">{timerLabel}</p>
                  <p className="placement-note">
                    {phase === "recording"
                      ? "Keep speaking, then tap stop when you're done."
                      : "Speak freely for up to 5 minutes. There are no wrong answers!"}
                  </p>
                  {phase === "recording" ? (
                    <button className="btn record-stop-btn placement-stop-btn-live" onClick={stopRecording}>
                      ⏹️ I&apos;m done!
                    </button>
                  ) : (
                    <button className="btn task-start-btn placement-main-btn" onClick={startRecording}>
                      🎙️ Start recording
                    </button>
                  )}
                </div>
              </section>
            )}

            {busyPhase && (
              <section className="placement-panel placement-processing-panel">
                <p className="placement-loading-title">
                  {busyPhase === "uploading" && "Uploading your recording..."}
                  {busyPhase === "processing" && "Doing some magic..."}
                  {busyPhase === "submitting" && "Submitting..."}
                </p>
                <div className="placement-processing-playground" aria-hidden>
                  <div className="placement-processing-orbit">
                    <span className="placement-processing-core">✨</span>
                    <span className="placement-processing-sat placement-processing-sat-a">🎤</span>
                    <span className="placement-processing-sat placement-processing-sat-b">⭐</span>
                    <span className="placement-processing-sat placement-processing-sat-c">🧠</span>
                  </div>
                  <div className="placement-processing-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <p className="placement-processing-hint">
                  {busyHints[busyPhase][busyHintIndex % busyHints[busyPhase].length]}
                </p>
                <div className="placement-mini-game">
                  <div className="placement-mini-game-head">
                    <p className="placement-mini-game-title">Mini-game: catch the sparkles</p>
                    <p className="placement-mini-game-score">
                      Score: {gameScore} | Best: {gameBest}
                    </p>
                  </div>
                  <div className="placement-mini-game-board">
                    {gameTarget && (
                      <button
                        type="button"
                        className={`placement-mini-game-target points-${gameTarget.points}`}
                        style={{ left: `${gameTarget.x}%`, top: `${gameTarget.y}%` }}
                        onClick={hitProcessingGameTarget}
                        aria-label="Catch sparkle"
                      >
                        {gameTarget.emoji}
                      </button>
                    )}
                  </div>
                  <p className="placement-mini-game-note">Tap moving icons while we process your answer.</p>
                </div>
              </section>
            )}

            {phase === "feedback" && attemptResult && (
              <section className="placement-panel">
                {attemptResult.status === "failed" && (
                  <p className="placement-warning">
                    Processing failed, but your response was still saved.
                  </p>
                )}

                {attemptResult.results?.transcript && (
                  <article className="placement-mini-card">
                    <p className="placement-mini-label">Transcript</p>
                    <p className="placement-transcript">{attemptResult.results.transcript}</p>
                  </article>
                )}

                {attemptResult.results?.scores?.overallScore != null && (
                  <article className="placement-mini-card">
                    <p className="placement-mini-label">Score</p>
                    <p className="placement-score-value">
                      {Math.round(attemptResult.results.scores.overallScore)}
                    </p>
                  </article>
                )}

                <p className="placement-feedback-title">How did that feel?</p>
                <div className="placement-feedback-actions">
                  <button className="btn ghost" onClick={() => submitFeedback("too_easy")}>
                    Too easy
                  </button>
                  <button className="btn placement-feedback-primary" onClick={() => submitFeedback("just_right")}>
                    Just right
                  </button>
                  <button className="btn ghost" onClick={() => submitFeedback("too_hard")}>
                    Too hard
                  </button>
                </div>
              </section>
            )}

            {phase === "done" && (
              <section className="placement-panel placement-done-panel">
                <p className="placement-done-title">Placement test complete!</p>
                {placementResult ? (
                  <>
                    <p className="placement-note">
                      Based on {attemptNumber} conversation{attemptNumber > 1 ? "s" : ""}, here is your
                      speaking level:
                    </p>
                    <div className="placement-stage-wrap">
                      <p className="placement-stage-value">{placementResult.stage}</p>
                      <p className="placement-stage-label">{stageLabel(placementResult.stage)}</p>
                      <p className="placement-stage-confidence">
                        Confidence: {Math.round(placementResult.confidence * 100)}%
                      </p>
                    </div>

                    {placementResult.domainStages && (
                      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: "16px 0", borderTop: "1px solid #eee" }}>
                        <DomainBar label="Vocabulary" stage={placementResult.domainStages.vocab.stage} />
                        <DomainBar label="Grammar" stage={placementResult.domainStages.grammar.stage} />
                        <DomainBar label="Communication" stage={placementResult.domainStages.communication.stage} />
                        {placementResult.pronunciationScore != null && (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "0.9rem" }}>
                            <span style={{ width: 120, color: "#555", textAlign: "right" }}>Pronunciation</span>
                            <div style={{ flex: 1, height: 10, background: "#eee", borderRadius: 5, overflow: "hidden" }}>
                              <div style={{ width: `${placementResult.pronunciationScore}%`, height: "100%", background: "#40916c", borderRadius: 5 }} />
                            </div>
                            <span style={{ width: 48, fontWeight: 600, color: "#2d6a4f" }}>
                              {Math.round(placementResult.pronunciationScore)}/100
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="placement-note">Your results are being calculated...</p>
                )}
                <Link className="btn task-start-btn placement-continue-btn" href="/home">
                  Continue
                </Link>
              </section>
            )}

            {error && <p className="placement-error">{error}</p>}

            {phase !== "starting" && phase !== "done" && (
              <button className="btn ghost placement-reset-btn" onClick={resetPlacement}>
                Start over
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
