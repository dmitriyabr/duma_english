"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  LessonMissionHeaderView,
  LessonSessionView,
  LessonStepView,
  LessonSummaryView,
} from "@/lib/contracts/lessonRuntime";

type RuntimePayload = {
  lessonSession: LessonSessionView;
  activeStep: LessonStepView | null;
  missionHeader: LessonMissionHeaderView;
};

type RuntimeStatePayload = RuntimePayload & {
  runtimeState: {
    missionProgress: {
      completedSteps: number;
      totalSteps: number;
    };
    transferPassed: boolean;
    correctivePending: boolean;
  };
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

async function pollAttemptUntilTerminal(attemptId: string) {
  for (let i = 0; i < 45; i += 1) {
    const response = await fetch(`/api/attempts/${attemptId}`);
    if (!response.ok) throw new Error("Unable to read attempt result");
    const payload = (await response.json()) as { status?: string };
    if (payload.status === "completed" || payload.status === "failed" || payload.status === "needs_retry") {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 1300));
  }
  throw new Error("Attempt processing timeout");
}

function findLastStudentTurnId(step: LessonStepView | null) {
  if (!step) return null;
  const turns = [...step.turns].reverse();
  const row = turns.find((turn) => turn.role === "student");
  return row?.id || null;
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function stepTypeLabel(stepType: LessonStepView["stepType"]) {
  if (stepType === "dialogue") return "Story scene";
  if (stepType === "drill") return "Retry scene";
  if (stepType === "transfer") return "Bonus scene";
  return "Final scene";
}

function displayTurnText(turn: LessonStepView["turns"][number]) {
  if (turn.promptText) return turn.promptText;
  return turn.role === "coach" ? "Guide is ready." : "Your line was sent.";
}

export default function LessonPage() {
  const [runtime, setRuntime] = useState<RuntimeStatePayload | null>(null);
  const [summary, setSummary] = useState<LessonSummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<number | null>(null);

  const sessionId = runtime?.lessonSession.id || null;
  const activeStep = runtime?.activeStep || null;
  const task = activeStep?.task || null;
  const canUseText = task?.assessmentMode === "text";
  const canRecord = Boolean(task && task.assessmentMode !== "text");
  const lastStudentTurnId = findLastStudentTurnId(activeStep);

  const loadActiveLesson = useCallback(async () => {
    setError(null);
    const activeRes = await fetch("/api/lesson/active");
    if (!activeRes.ok) {
      if (activeRes.status === 401) {
        throw new Error("Please login first.");
      }
      throw new Error("Unable to load lesson");
    }
    const active = (await activeRes.json()) as {
      lessonSession: LessonSessionView | null;
    };

    let id = active.lessonSession?.id || null;
    if (!id) {
      const startRes = await fetch("/api/lesson/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceNew: false }),
      });
      if (!startRes.ok) throw new Error("Unable to start lesson");
      const started = (await startRes.json()) as RuntimePayload;
      id = started.lessonSession.id;
    }

    const stateRes = await fetch(`/api/lesson/${id}/state`);
    if (!stateRes.ok) throw new Error("Unable to load lesson state");
    const state = (await stateRes.json()) as RuntimeStatePayload;
    setRuntime(state);
  }, []);

  useEffect(() => {
    loadActiveLesson().catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to load lesson");
    });
  }, [loadActiveLesson]);

  useEffect(() => {
    if (status !== "Recording") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, []);

  const stepHint = useMemo(() => {
    if (!runtime?.activeStep) return "You did it. Tap Finish.";
    if (runtime.activeStep.stepType === "transfer") return "New place, same skill.";
    if (runtime.activeStep.stepType === "drill") return "Tiny retry, then keep going.";
    return "Say your next line.";
  }, [runtime?.activeStep]);

  async function refreshState() {
    if (!sessionId) return;
    const response = await fetch(`/api/lesson/${sessionId}/state`);
    if (!response.ok) throw new Error("Unable to refresh lesson state");
    const payload = (await response.json()) as RuntimeStatePayload;
    setRuntime(payload);
  }

  async function sendTurnWithAttempt(attemptId: string, mode: "voice" | "text", durationSec?: number) {
    if (!sessionId) return;

    const turnRes = await fetch(`/api/lesson/${sessionId}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        payloadRef: attemptId,
        ...(typeof durationSec === "number" ? { durationSec } : {}),
      }),
    });

    if (!turnRes.ok) {
      const payload = (await turnRes.json()) as { error?: string };
      throw new Error(payload.error || "Unable to submit lesson turn");
    }

    const payload = (await turnRes.json()) as {
      nextAction: "next_turn" | "fix_now" | "transfer_step" | "step_done";
      lessonSession: LessonSessionView;
      activeStep: LessonStepView | null;
      missionHeader: LessonMissionHeaderView;
    };

    setRuntime((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        lessonSession: payload.lessonSession,
        activeStep: payload.activeStep,
        missionHeader: payload.missionHeader,
      };
    });
  }

  async function submitVoice(blob: Blob, durationSec: number) {
    if (!task || !sessionId) return;

    const createResponse = await fetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.taskId,
        contentType: "audio/wav",
        durationSec,
      }),
    });

    if (!createResponse.ok) {
      const payload = (await createResponse.json()) as { error?: string };
      throw new Error(payload.error || "Unable to create attempt");
    }

    const createPayload = (await createResponse.json()) as { attemptId: string };

    const uploadResponse = await fetch(`/api/attempts/${createPayload.attemptId}/upload`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: blob,
    });

    if (!uploadResponse.ok) {
      const payload = (await uploadResponse.json()) as { error?: string };
      throw new Error(payload.error || "Unable to upload audio");
    }

    await pollAttemptUntilTerminal(createPayload.attemptId);
    await sendTurnWithAttempt(createPayload.attemptId, "voice", durationSec);
  }

  async function handleTextSubmit() {
    if (!task || !sessionId) return;
    const words = countWords(draft);
    if (words < 8) {
      setError("Write at least 8 words.");
      return;
    }

    setBusy(true);
    setStatus("Submitting text");
    setError(null);
    try {
      const response = await fetch("/api/attempts/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.taskId,
          text: draft.trim(),
          durationSec: Math.max(6, Math.min(900, Math.round(words / 2))),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Unable to submit text attempt");
      }

      const payload = (await response.json()) as { attemptId: string };
      await pollAttemptUntilTerminal(payload.attemptId);
      await sendTurnWithAttempt(payload.attemptId, "text");
      setDraft("");
      setStatus("Idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Text submission failed");
      setStatus("Idle");
    } finally {
      setBusy(false);
    }
  }

  function cleanupRecorder() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
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
    if (!canRecord || !task) return;
    setError(null);
    setBusy(false);
    setSeconds(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(channel));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      processorRef.current = processor;

      setStatus("Recording");
      timerRef.current = window.setTimeout(() => {
        void stopRecording();
      }, task.maxDurationSec * 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to access microphone");
      cleanupRecorder();
      setStatus("Idle");
    }
  }

  async function stopRecording() {
    if (status !== "Recording") return;

    const context = audioContextRef.current;
    const chunks = chunksRef.current.slice();
    cleanupRecorder();

    if (!context || chunks.length === 0) {
      setError("No audio captured");
      setStatus("Idle");
      return;
    }

    const merged = flattenChunks(chunks);
    const downsampled = downsampleTo16k(merged, context.sampleRate);
    const pcm16 = floatTo16BitPCM(downsampled);
    const wavBlob = encodeWav(pcm16, 16000);
    const durationSec = Number((downsampled.length / 16000).toFixed(2));

    setBusy(true);
    setStatus("Uploading");
    setError(null);
    try {
      await submitVoice(wavBlob, durationSec);
      setStatus("Idle");
      setSeconds(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice submission failed");
      setStatus("Idle");
    } finally {
      setBusy(false);
    }
  }

  async function handleFixNow() {
    if (!sessionId || !lastStudentTurnId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/lesson/${sessionId}/fix-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceTurnId: lastStudentTurnId }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Unable to start fix-now");
      }
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start fix-now");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdvance(action: "next_turn" | "next_step") {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/lesson/${sessionId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Unable to advance");
      }
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to advance");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinishLesson() {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/lesson/${sessionId}/finish`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Unable to finish lesson");
      }
      const payload = (await response.json()) as { lessonSummary: LessonSummaryView };
      setSummary(payload.lessonSummary);
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to finish lesson");
    } finally {
      setBusy(false);
    }
  }

  const mainActionDisabled = busy || !runtime;
  const recording = status === "Recording";
  const actionLabel = recording
    ? "Stop and send"
    : canRecord
    ? "Start recording"
    : canUseText
    ? "Send answer"
    : "Continue";

  if (!runtime && !error) {
    return (
      <div className="page task-page lesson-page">
        <section className="task-hero">
          <div className="task-mobile-frame">
            <p className="task-kicker">MISSION</p>
            <h1 className="task-title-main">Preparing your mission...</h1>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page task-page lesson-page">
      <section className="task-hero lesson-hero">
        <div className="task-mobile-frame lesson-frame">
          <div className="task-top-row">
            <div className="task-nav-mini">
              <Link href="/home">Home</Link>
              <Link href="/progress">Progress</Link>
            </div>
          </div>

          <p className="task-kicker">MISSION</p>
          <h1 className="task-title-main">{runtime?.missionHeader.title || "Your mission"}</h1>
          <h2 className="task-title-accent lesson-accent">{runtime?.missionHeader.goal || "Start scene one."}</h2>

          {error && <p className="task-error">{error}</p>}

          <div className="lesson-shell">
            <section className="lesson-panel lesson-mission-header">
              <div>
                <p className="lesson-meta">{runtime?.missionHeader.stepLabel}</p>
                <strong>{runtime?.missionHeader.progressLabel}</strong>
              </div>
              <div>
                <p className="lesson-meta">Bonus scene</p>
                <strong>{runtime?.runtimeState.transferPassed ? "Done" : "Next"}</strong>
              </div>
              <div>
                <p className="lesson-meta">Mode</p>
                <strong>Voice first</strong>
              </div>
            </section>

            <section className="lesson-panel">
              <p className="lesson-panel-title">Your scene</p>
              {activeStep ? (
                <>
                  <p className="lesson-step-type">{stepTypeLabel(activeStep.stepType)}</p>
                  <p className="lesson-step-prompt">{task?.prompt || "Scene is loading."}</p>
                  <p className="lesson-step-hint">{stepHint}</p>
                </>
              ) : (
                <p className="lesson-step-hint">Great run. You can finish now.</p>
              )}
            </section>

            <section className="lesson-panel">
              <p className="lesson-panel-title">Chat story</p>
              {activeStep?.turns.length ? (
                <div className="lesson-turns">
                  {activeStep.turns.slice(-6).map((turn) => (
                    <article key={turn.id} className={`lesson-turn ${turn.role === "coach" ? "lesson-turn-coach" : "lesson-turn-student"}`}>
                      <p className="lesson-turn-role">{turn.role === "coach" ? "Guide" : "You"}</p>
                      <p className="lesson-turn-text">{displayTurnText(turn)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="lesson-step-hint">No lines yet. Say your first line.</p>
              )}
            </section>

            <section className="lesson-panel">
              <p className="lesson-panel-title">Say it</p>
              {canUseText ? (
                <div className="lesson-text-box">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Type your line..."
                    rows={5}
                    disabled={busy}
                  />
                  <p className="lesson-step-hint">Words: {countWords(draft)}</p>
                </div>
              ) : (
                <div className="lesson-voice-box">
                  <p className="lesson-step-hint">Timer: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>
                  <p className="lesson-step-hint">Mic: {status}</p>
                </div>
              )}
            </section>

            <section className="lesson-panel lesson-actions">
              <button
                className="btn task-start-btn lesson-main-btn"
                disabled={mainActionDisabled || (!canUseText && !canRecord)}
                onClick={() => {
                  if (canUseText) {
                    void handleTextSubmit();
                    return;
                  }
                  if (recording) {
                    void stopRecording();
                    return;
                  }
                  void startRecording();
                }}
              >
                {busy ? "Checking..." : actionLabel}
              </button>

              <div className="lesson-secondary-row">
                <button
                  className="btn ghost"
                  disabled={busy || !lastStudentTurnId}
                  onClick={() => {
                    void handleFixNow();
                  }}
                >
                  Retry line
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => {
                    void handleAdvance("next_step");
                  }}
                >
                  Next scene
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => {
                    void handleFinishLesson();
                  }}
                >
                  Finish mission
                </button>
              </div>
            </section>

            {summary && (
              <section className="lesson-panel lesson-summary">
                <p className="lesson-panel-title">Mission recap</p>
                <p className="lesson-step-hint">
                  Stars: {summary.goalCoverage.completedSteps}/{summary.goalCoverage.totalSteps} | Bonus scene:{" "}
                  {summary.transfer.passed ? "done" : "next"}
                </p>
                <p className="lesson-step-hint">
                  Retries won: {summary.corrective.resolvedCount}/{summary.corrective.triggeredCount}
                </p>
                <p className="lesson-step-hint">
                  Next quest: {summary.nextFocus.join(", ") || "Keep going"}
                </p>
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
