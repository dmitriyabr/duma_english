"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type TaskResponse = {
  taskId: string;
  type: string;
  prompt: string;
  assessmentMode: "pa" | "stt";
  maxDurationSec: number;
  constraints: { minSeconds: number; maxSeconds: number };
  stage?: string;
  ageBand?: string;
  reason?: string;
  selectionReason?: string;
  decisionId?: string;
  primaryGoal?: string;
  selectionReasonType?: "weakness" | "overdue" | "uncertainty" | "verification";
  verificationTargetNodeIds?: string[];
  expectedGain?: number;
  difficulty?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  rotationApplied?: boolean;
  rotationReason?: string | null;
  similarityToRecent?: number;
  targetSkills?: string[];
  targetWords?: string[];
  targetNodeIds?: string[];
};

function taskGuide(type: string) {
  if (type !== "speech_builder") return null;
  return {
    title: "How to do this in 4 steps",
    steps: [
      "Sentence 1: Say what your topic is.",
      "Sentence 2: Say your main idea.",
      "Sentence 3: Give one example.",
      "Sentence 4: Finish clearly.",
    ],
    example:
      "My topic is reading books. I think reading helps me learn faster. For example, I learn new words when I read stories. So I try to read every day.",
  };
}

function taskActionCopy(taskType?: string) {
  if (taskType === "read_aloud") {
    return {
      cta: "I'm ready to read!",
      sub: "Tap once and read with your best voice.",
    };
  }
  if (taskType === "target_vocab") {
    return {
      cta: "I'm ready!",
      sub: "Use your power words and shine.",
    };
  }
  if (taskType === "speech_builder") {
    return {
      cta: "Let's build it!",
      sub: "Start your mini-talk in one tap.",
    };
  }
  return {
    cta: "I'm ready!",
    sub: "Big button. Brave voice. Super quest.",
  };
}

function taskExampleQuote(task: TaskResponse | null) {
  if (!task) return "I can do this!";
  const words = (task.targetWords || []).map((w) => w.trim()).filter(Boolean).slice(0, 2);
  if (words.length >= 2) {
    return `I like ${words[0]} and ${words[1]}. Me too!`;
  }
  if (task.type === "read_aloud") {
    return "I can read this clearly and with confidence!";
  }
  if (task.type === "speech_builder") {
    return "My topic, my idea, my example, my ending!";
  }
  return "I can do this challenge. Let's go!";
}

export default function TaskPage() {
  const router = useRouter();
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const requestedType =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("type") : null;
    const endpoint = requestedType
      ? `/api/task/next?type=${encodeURIComponent(requestedType)}`
      : "/api/task/next";
    fetch(endpoint, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: TaskResponse) => {
        if (!active) return;
        setTask(json);
        localStorage.setItem("currentTask", JSON.stringify(json));
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        if (active) setError("Unable to load a task. Please login again.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const guide = task ? taskGuide(task.type) : null;
  const hasCoachNotes = Boolean(
    task?.reason ||
      task?.selectionReason ||
      task?.primaryGoal ||
      task?.selectionReasonType ||
      task?.fallbackUsed ||
      task?.rotationApplied ||
      typeof task?.expectedGain === "number" ||
      typeof task?.difficulty === "number" ||
      typeof task?.similarityToRecent === "number" ||
      (task?.verificationTargetNodeIds?.length || 0) > 0 ||
      (task?.targetSkills?.length || 0) > 0
  );
  const actionCopy = taskActionCopy(task?.type);
  const exampleQuote = taskExampleQuote(task);
  const modeLabel = task?.assessmentMode === "pa" ? "Read Aloud" : "Free Talk";
  const levelLabel = `${task?.stage || "A0"} Star`;

  return (
    <div className="page task-page">
      <section className="task-hero">
        <div className="task-mobile-frame">
          <div className="task-floating-star" aria-hidden>
            ★
          </div>
          <div className="task-floating-cloud" aria-hidden />

          <div className="task-top-row">
            <div className="task-nav-mini">
              <Link href="/home">Home</Link>
              <Link href="/progress">Progress</Link>
            </div>
          </div>

          <p className="task-kicker">✨ TODAY&apos;S QUEST</p>
          <h1 className="task-title-main">Ready for a</h1>
          <h2 className="task-title-accent">Super Quest?</h2>

          {error && (
            <p className="task-error">
              {error} <Link href="/login">Login</Link>
            </p>
          )}

          {task ? (
            <>
              <div className="task-main-grid">
                <div className="task-main-left">
                  <article className="task-mission-card">
                    <div className="task-mission-top">
                      <div className="task-icon-circle" aria-hidden>
                        🗺️
                      </div>
                      <div className="task-mission-copy">
                        <p className="task-mission-label">YOUR MISSION:</p>
                        <p className="task-prompt-text">{task.prompt}</p>
                      </div>
                    </div>

                    <div className="task-example-bubble">
                      <p>{exampleQuote}</p>
                    </div>
                  </article>

                  {guide && (
                    <div className="task-guide">
                      <p className="task-section-title">{guide.title}</p>
                      <ol className="task-guide-list">
                        {guide.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>

                <div className="task-main-right">
                  <div className="task-stats-grid">
                    <div className="task-stat">
                      <div className="task-stat-icon">🕒</div>
                      <p className="task-stat-title">TIMER</p>
                      <p className="task-stat-value">
                        {task.constraints.minSeconds}-{task.constraints.maxSeconds}s
                      </p>
                    </div>

                    <div className="task-stat">
                      <div className="task-stat-icon">🎤</div>
                      <p className="task-stat-title">MODE</p>
                      <p className="task-stat-value">{modeLabel}</p>
                    </div>

                    <div className="task-stat">
                      <div className="task-stat-icon">⭐</div>
                      <p className="task-stat-title">LEVEL</p>
                      <p className="task-stat-value">{levelLabel}</p>
                    </div>
                  </div>
                  <div className="task-start-wrap">
                    <button className="btn task-start-btn" onClick={() => router.push("/record")}>
                      <span className="task-cta-icon">📣</span>
                      {actionCopy.cta}
                    </button>
                    <p className="task-start-sub">{actionCopy.sub}</p>
                  </div>
                </div>
              </div>

              {hasCoachNotes && (
                <details className="task-coach-notes">
                  <summary>Coach notes</summary>
                  <ul className="task-note-list">
                    {task.reason && <li>{task.reason}</li>}
                    {task.selectionReason && <li>{task.selectionReason}</li>}
                    {typeof task.expectedGain === "number" && (
                      <li>
                        Expected gain: {task.expectedGain.toFixed(2)} | Difficulty:{" "}
                        {typeof task.difficulty === "number" ? Math.round(task.difficulty) : "n/a"}
                      </li>
                    )}
                    {task.primaryGoal && <li>Primary goal: {task.primaryGoal}</li>}
                    {task.selectionReasonType && <li>Reason type: {task.selectionReasonType}</li>}
                    {(task.verificationTargetNodeIds?.length || 0) > 0 && (
                      <li>Verification queue targets: {task.verificationTargetNodeIds?.length}</li>
                    )}
                    {task.fallbackUsed && (
                      <li>
                        Task generator fallback used
                        {task.fallbackReason ? ` (${task.fallbackReason})` : ""}.
                      </li>
                    )}
                    {task.rotationApplied && (
                      <li>
                        Rotation applied
                        {task.rotationReason ? ` (${task.rotationReason})` : ""}.
                      </li>
                    )}
                    {typeof task.similarityToRecent === "number" && (
                      <li>Prompt similarity to recent tasks: {task.similarityToRecent.toFixed(2)}</li>
                    )}
                    {task.targetSkills && task.targetSkills.length > 0 && (
                      <li>Focus skills: {task.targetSkills.join(", ")}</li>
                    )}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div className="task-loading">
              <p className="task-loading-title">Preparing your super quest...</p>
              <p className="subtitle">Please wait for a few seconds.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
