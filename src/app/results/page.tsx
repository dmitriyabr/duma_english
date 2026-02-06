"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Feedback = {
  summary?: string;
  whatWentWell?: string[];
  whatToFixNow?: string[];
  exampleBetterAnswer?: string;
  nextMicroTask?: string;
};

type TaskEvaluation = {
  taskType?: string;
  taskScore?: number;
  artifacts?: Record<string, unknown>;
  rubricChecks?: Array<{ name?: string; pass?: boolean; reason?: string }>;
  evidence?: string[];
};

type MetricCard = {
  key: string;
  label: string;
  value: number;
  kind: "score" | "count" | "number";
};

type AttemptResult = {
  status: string;
  flow?: {
    isPlacement?: boolean;
    placementSessionId?: string | null;
  };
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
  results: {
    transcript?: string | null;
    scores?: {
      speechScore?: number | null;
      taskScore?: number | null;
      overallScore?: number | null;
    } | null;
    speech?: {
      accuracy?: number;
      fluency?: number;
      completeness?: number;
      prosody?: number;
      confidence?: number;
      speechRate?: number;
      fillerCount?: number;
      durationSec?: number;
      wordCount?: number;
    } | null;
    taskEvaluation?: TaskEvaluation | null;
    feedback?: Feedback | null;
    visibleMetrics?: MetricCard[];
    debug?: unknown;
  } | null;
};

function titleizeMetricKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
}

const ARTIFACT_LABELS: Record<string, string> = {
  hookPresent: "Strong start",
  pointPresent: "Main idea is clear",
  examplePresent: "Has an example",
  closePresent: "Clear ending",
  orderQuality: "Structure order",
  requiredWordsUsed: "Target words used",
  missingWords: "Missing target words",
  wordUsageCorrectness: "Word usage correctness",
  referenceCoverage: "Reference coverage",
  requiredActsCompleted: "Role-play actions done",
  supportingDetailCount: "Supporting details",
  coherenceSignals: "Linking words used",
  fillerDensityPer100Words: "Fillers per 100 words",
  topFillers: "Most common fillers",
  selfCorrections: "Self-corrections",
  questionAnswered: "Question answered",
  directAnswerFirst: "Direct answer first",
  supportingReasons: "Supporting reasons",
};

function displayArtifactLabel(key: string) {
  return ARTIFACT_LABELS[key] || titleizeMetricKey(key);
}

function renderArtifactValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((item) => String(item)).filter(Boolean);
    return parts.length ? parts.join(", ") : "";
  }
  return "";
}

export default function ResultsPage() {
  const [data, setData] = useState<AttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const idFromQuery =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("attemptId")
        : null;
    const idFromStorage = typeof window !== "undefined" ? localStorage.getItem("lastAttemptId") : null;
    const attemptId = idFromQuery || idFromStorage;
    if (!attemptId) {
      setError("No attempt found.");
      return;
    }

    let active = true;
    async function poll() {
      try {
        const res = await fetch(`/api/attempts/${attemptId}`);
        if (!res.ok) throw new Error("Unable to fetch results");
        const json: AttemptResult = await res.json();
        if (!active) return;
        setData(json);
        if (json.status !== "completed" && json.status !== "failed") {
          setTimeout(poll, 2000);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to fetch results");
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, []);

  const feedback = data?.results?.feedback;
  const taskEvaluation = data?.results?.taskEvaluation;
  const metricCards = useMemo(() => data?.results?.visibleMetrics || [], [data?.results?.visibleMetrics]);
  const artifactEntries = Object.entries(taskEvaluation?.artifacts || {}).filter(([, value]) => {
    const rendered = renderArtifactValue(value);
    return rendered.length > 0;
  });
  const checks = (taskEvaluation?.rubricChecks || []).filter((check) => !!check.name && check.reason);
  const transcript = data?.results?.transcript;
  const isPlacementFlow = Boolean(data?.flow?.isPlacement);
  const placementSessionId = data?.flow?.placementSessionId;

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Duma Trainer</strong>
        <div className="nav-links">
          <Link href="/task">New task</Link>
          <Link href="/progress">Progress</Link>
        </div>
      </nav>
      <section className="container">
        <div className="card">
          <h1 className="title">Results</h1>
          {error && <p style={{ color: "#c1121f" }}>{error}</p>}
          {!data && <p className="subtitle">Waiting for results...</p>}
          {data?.status === "failed" && (
            <p className="subtitle">
              Processing failed: {data.error?.message || "Unknown error"}{" "}
              {data.error?.code ? `(${data.error.code})` : ""}
            </p>
          )}
          {data?.status !== "completed" && data?.status !== "failed" && (
            <p className="subtitle">Processing your recording...</p>
          )}

          {data?.status === "completed" && (
            <>
              {metricCards.length > 0 && (
                <>
                  <div className="grid three">
                    {metricCards.map((metric) => (
                      <div className="metric" key={metric.key}>
                        <span>{metric.label}</span>
                        <strong>{Math.round(metric.value)}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="spacer" />
                </>
              )}

              {transcript && (
                <>
                  <div className="metric">
                    <span>Transcript</span>
                    <p className="subtitle">{transcript}</p>
                  </div>
                  <div className="spacer" />
                </>
              )}

              {feedback?.summary && (
                <>
                  <p className="subtitle">{feedback.summary}</p>
                  <div className="spacer" />
                </>
              )}

              {(feedback?.whatWentWell?.length || feedback?.whatToFixNow?.length) && (
                <>
                  <div className="grid two">
                    {(feedback.whatWentWell || []).length > 0 && (
                      <div className="metric">
                        <span>What went well</span>
                        <ul style={{ paddingLeft: 16 }}>
                          {(feedback.whatWentWell || []).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(feedback.whatToFixNow || []).length > 0 && (
                      <div className="metric">
                        <span>Improve next</span>
                        <ul style={{ paddingLeft: 16 }}>
                          {(feedback.whatToFixNow || []).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="spacer" />
                </>
              )}

              {artifactEntries.length > 0 && (
                <>
                  <div className="metric">
                    <span>Task facts</span>
                    <ul style={{ paddingLeft: 16 }}>
                      {artifactEntries.map(([key, value]) => (
                        <li key={key}>
                          {displayArtifactLabel(key)}: {renderArtifactValue(value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="spacer" />
                </>
              )}

              {checks.length > 0 && (
                <>
                  <div className="metric">
                    <span>Rubric checks</span>
                    <ul style={{ paddingLeft: 16 }}>
                      {checks.map((check) => (
                        <li key={check.name}>
                          {check.pass ? "Pass" : "Fix"}: {check.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="spacer" />
                </>
              )}

              {feedback?.exampleBetterAnswer && (
                <>
                  <div className="metric">
                    <span>Example better answer</span>
                    <p className="subtitle">{feedback.exampleBetterAnswer}</p>
                  </div>
                  <div className="spacer" />
                </>
              )}

              {feedback?.nextMicroTask && (
                <>
                  <div className="metric">
                    <span>Next micro task</span>
                    <p className="subtitle">{feedback.nextMicroTask}</p>
                  </div>
                  <div className="spacer" />
                </>
              )}

              {data.results?.debug && (
                <>
                  <div className="metric">
                    <span>AI debug (temporary)</span>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: "0.85rem",
                      }}
                    >
                      {JSON.stringify(data.results.debug, null, 2)}
                    </pre>
                  </div>
                  <div className="spacer" />
                </>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {isPlacementFlow && placementSessionId && (
                  <Link className="btn ghost" href={`/placement?session=${placementSessionId}`}>
                    Back to placement
                  </Link>
                )}
                <Link className="btn" href="/task">
                  Next task
                </Link>
                <Link className="btn ghost" href="/record">
                  Retry
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
