"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PlacementItem = {
  id: string;
  skillKey: string;
  taskType: string;
  prompt: string;
  hint: string;
  expectedMinWords: number;
  assessmentMode: "pa" | "stt";
  maxDurationSec: number;
  difficulty: number;
  discrimination: number;
};

type PlacementState = {
  placementId: string;
  status: "started" | "completed";
  theta?: number;
  sigma?: number;
  confidenceEstimate?: number;
  stageEstimate?: string;
  currentIndex: number;
  questionCount?: number;
  totalQuestions: number;
  currentQuestion: PlacementItem | null;
  nextItem?: PlacementItem | null;
  result?: {
    stage: string;
    average: number;
    confidence: number;
    skillSnapshot: Record<string, number>;
    carryoverApplied?: boolean;
    carryoverNodes?: string[];
  } | null;
};

type PlacementTaskResponse = {
  taskId: string;
  type: string;
  prompt: string;
  assessmentMode: "pa" | "stt";
  maxDurationSec: number;
  constraints: { minSeconds: number; maxSeconds: number };
  placement: {
    itemId: string;
    skillKey: string;
    currentIndex: number;
    totalQuestions: number;
    theta?: number;
    sigma?: number;
  };
};

export default function PlacementPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<PlacementState | null>(null);

  useEffect(() => {
    // Placement is now hidden in UX; cold-start diagnostics run inside normal tasks.
    router.replace("/task");
  }, [router]);

  useEffect(() => {
    let active = true;
    let timer: NodeJS.Timeout | null = null;

    async function refresh() {
      try {
        const startRes = await fetch("/api/placement/start", { method: "POST" });
        if (!startRes.ok) throw new Error("Unable to start placement.");
        const startJson = (await startRes.json()) as PlacementState;
        if (!active) return;

      const statusRes = await fetch(`/api/placement/${startJson.placementId}`);
        if (!statusRes.ok) throw new Error("Unable to fetch placement status.");
        const statusJson = (await statusRes.json()) as PlacementState;
        if (!active) return;
        setState(statusJson);
        if (statusJson.status === "completed") {
          localStorage.removeItem("activePlacement");
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load placement.");
      } finally {
        if (active) setLoading(false);
      }
    }

    refresh();
    timer = setInterval(refresh, 2500);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  async function startRecordingAnswer() {
    if (!state?.placementId || !state.currentQuestion) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/placement/${state.placementId}/task`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to create placement task.");
      }
      const task = (await response.json()) as PlacementTaskResponse;
      localStorage.setItem("currentTask", JSON.stringify(task));
      localStorage.setItem(
        "activePlacement",
        JSON.stringify({
          placementId: state.placementId,
          itemId: task.placement.itemId,
        })
      );
      router.push(`/record?placementId=${state.placementId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start recording.");
    } finally {
      setStarting(false);
    }
  }

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
          <h1 className="title">Adaptive Placement</h1>
          <p className="subtitle">Short audio check to set your level and personal plan.</p>
          {loading && <p className="subtitle">Loading placement...</p>}
          {error && <p style={{ color: "#c1121f" }}>{error}</p>}

          {state && state.status === "started" && state.currentQuestion && (
            <>
              <div className="spacer" />
              <div className="metric">
                <span>
                  Question {state.questionCount || state.currentIndex + 1} / {state.totalQuestions}
                </span>
                <p className="subtitle">{state.currentQuestion.prompt}</p>
                <p className="subtitle">Hint: {state.currentQuestion.hint}</p>
                <p className="subtitle">
                  Mode: {state.currentQuestion.assessmentMode.toUpperCase()} | Max {state.currentQuestion.maxDurationSec}s
                </p>
                {typeof state.theta === "number" && typeof state.sigma === "number" && (
                  <p className="subtitle">
                    Ability: {state.theta.toFixed(2)} | Uncertainty: {state.sigma.toFixed(2)}
                    {state.stageEstimate ? ` | Stage estimate: ${state.stageEstimate}` : ""}
                  </p>
                )}
              </div>
              <div className="spacer" />
              <button className="btn" disabled={starting} onClick={startRecordingAnswer}>
                {starting ? "Preparing..." : "Record answer"}
              </button>
            </>
          )}

          {state && state.status === "completed" && state.result && (
            <>
              <div className="spacer" />
              <div className="grid two">
                <div className="metric">
                  <span>Your stage</span>
                  <strong>{state.result.stage}</strong>
                </div>
                <div className="metric">
                  <span>Placement score</span>
                  <strong>{Math.round(state.result.average)}</strong>
                  <p className="subtitle">Confidence: {Math.round(state.result.confidence * 100)}%</p>
                </div>
              </div>
              <div className="spacer" />
              <div className="metric">
                <span>Skill snapshot</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {Object.entries(state.result.skillSnapshot).map(([skill, value]) => (
                    <div key={skill} style={{ minWidth: 130 }}>
                      <strong>{skill}</strong>
                      <div className="subtitle">{Math.round(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="spacer" />
              {state.result.carryoverApplied && (
                <>
                  <div className="metric">
                    <span>Fast-track applied</span>
                    <p className="subtitle">
                      Lower-level A1/A2 bundles were auto-marked as covered based on strong placement.
                    </p>
                  </div>
                  <div className="spacer" />
                </>
              )}
              <button className="btn" onClick={() => router.push("/task")}>
                Start learning
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
