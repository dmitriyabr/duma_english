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

export default function TaskPage() {
  const router = useRouter();
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const requestedType =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("type") : null;
    const endpoint = requestedType
      ? `/api/task/next?type=${encodeURIComponent(requestedType)}`
      : "/api/task/next";
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: TaskResponse) => {
        if (!active) return;
        setTask(json);
        localStorage.setItem("currentTask", JSON.stringify(json));
      })
      .catch(() => {
        if (active) setError("Unable to load a task. Please login again.");
      });
    return () => {
      active = false;
    };
  }, []);

  const guide = task ? taskGuide(task.type) : null;

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Duma Trainer</strong>
        <div className="nav-links">
          <Link href="/home">Home</Link>
          <Link href="/progress">Progress</Link>
        </div>
      </nav>
      <section className="container">
        <div className="card">
          <h1 className="title">Your Task</h1>
          {error && (
            <p style={{ color: "#c1121f" }}>
              {error} <Link href="/login">Login</Link>
            </p>
          )}
          {task ? (
            <>
              <p className="subtitle">{task.prompt}</p>
              <div className="spacer" />
              <div className="status">
                <span className="status-dot" />
                Aim for {task.constraints.minSeconds}-{task.constraints.maxSeconds} seconds
              </div>
              <div className="status">
                <span className="status-dot" />
                Assessment mode: {task.assessmentMode.toUpperCase()} | Max {task.maxDurationSec}s
              </div>
              {task.stage && (
                <div className="status">
                  <span className="status-dot" />
                  Stage: {task.stage} | Age group: {task.ageBand || "9-11"}
                </div>
              )}
              {task.reason && (
                <div className="metric" style={{ marginTop: 12 }}>
                  <span>Why this task</span>
                  <p className="subtitle">{task.reason}</p>
                  {task.selectionReason && <p className="subtitle">{task.selectionReason}</p>}
                  {typeof task.expectedGain === "number" && (
                    <p className="subtitle">
                      Expected gain: {task.expectedGain.toFixed(2)} | Difficulty:{" "}
                      {typeof task.difficulty === "number" ? Math.round(task.difficulty) : "n/a"}
                    </p>
                  )}
                  {task.primaryGoal && <p className="subtitle">Primary goal: {task.primaryGoal}</p>}
                  {task.selectionReasonType && (
                    <p className="subtitle">Reason type: {task.selectionReasonType}</p>
                  )}
                  {(task.verificationTargetNodeIds?.length || 0) > 0 && (
                    <p className="subtitle">
                      Verification queue targets: {task.verificationTargetNodeIds?.length}
                    </p>
                  )}
                  {task.fallbackUsed && (
                    <p className="subtitle">
                      Task generator fallback was used for reliability
                      {task.fallbackReason ? ` (${task.fallbackReason})` : ""}.
                    </p>
                  )}
                  {task.rotationApplied && (
                    <p className="subtitle">
                      Rotation applied to avoid loop
                      {task.rotationReason ? ` (${task.rotationReason})` : ""}.
                    </p>
                  )}
                  {typeof task.similarityToRecent === "number" && (
                    <p className="subtitle">Prompt similarity to recent tasks: {task.similarityToRecent.toFixed(2)}</p>
                  )}
                  {task.targetSkills && task.targetSkills.length > 0 && (
                    <p className="subtitle">Focus skills: {task.targetSkills.join(", ")}</p>
                  )}
                  {task.targetWords && task.targetWords.length > 0 && (
                    <p className="subtitle">Target words: {task.targetWords.join(", ")}</p>
                  )}
                </div>
              )}
              {guide && (
                <>
                  <div className="spacer" />
                  <div className="metric">
                    <span>{guide.title}</span>
                    <ol style={{ paddingLeft: 18, margin: 0 }}>
                      {guide.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <p className="subtitle" style={{ marginTop: 8 }}>
                      Example: {guide.example}
                    </p>
                  </div>
                </>
              )}
              <div className="spacer" />
              <button
                className="btn"
                onClick={() => router.push("/record")}
              >
                Start recording
              </button>
            </>
          ) : (
            <p className="subtitle">Loading task...</p>
          )}
        </div>
      </section>
    </div>
  );
}
