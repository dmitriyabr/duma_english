"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ATTEMPT_STATUS, isAttemptRetryStatus, isAttemptTerminalStatus } from "@/lib/attemptStatus";

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
  retry?: {
    required: true;
    reasonCode?: string | null;
    message?: string | null;
  } | null;
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
    language?: {
      grammar?: {
        grammarAccuracy?: number;
        errorCountByType?: Record<string, number> | null;
        topErrors?: Array<{ error?: string; correction?: string; explanation?: string }>;
      };
      discourse?: {
        coherenceScore?: number;
        argumentScore?: number;
        registerScore?: number;
      };
    } | null;
    gseEvidence?: Array<{
      nodeId: string;
      descriptor: string;
      signal: string;
      confidence: number;
      impact: number;
      gseCenter?: number | null;
      skill?: string | null;
      type?: string | null;
      targeted?: boolean;
      activationImpact?: "none" | "observed" | "candidate" | "verified";
    }>;
    incidentalFindings?: Array<{
      nodeId: string;
      nodeLabel: string;
      domain: "vocab" | "grammar" | "lo";
      signal: string;
      score: number;
      confidence: number;
      targeted: boolean;
      activationImpact: "none" | "observed" | "candidate" | "verified";
    }>;
    activationTransitions?: Array<{
      nodeId: string;
      activationStateBefore?: "observed" | "candidate_for_verification" | "verified" | null;
      activationStateAfter?: "observed" | "candidate_for_verification" | "verified" | null;
      activationImpact: "none" | "observed" | "candidate" | "verified";
      verificationDueAt?: string | null;
    }>;
    nodeOutcomes?: Array<{
      nodeId: string;
      deltaMastery: number;
      decayImpact: number;
      reliability: "high" | "medium" | "low";
      evidenceCount: number;
    }>;
    recoveryTriggered?: boolean;
    planner?: {
      decisionId: string;
      selectionReason?: string | null;
      primaryGoal?: string | null;
      expectedGain?: number | null;
      estimatedDifficulty?: number | null;
    } | null;
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

const PROCESSING_HINTS = [
  "Listening for your best phrases...",
  "Checking your brave voice power...",
  "Finding your strongest ideas...",
  "Building helpful feedback cards...",
  "Packing your next speaking quest...",
  "Polishing your result stars...",
];

function retryHeadline(reasonCode?: string | null) {
  if (reasonCode === "RETRY_OFF_TOPIC") {
    return "🧭 I'm sorry, this sounds like another topic. Let's read the task and try again.";
  }
  return "🎤 I'm sorry, I didn't hear you well. Can you try again?";
}

export default function ResultsPage() {
  const [data, setData] = useState<AttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyHintIndex, setBusyHintIndex] = useState(0);

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
        if (!isAttemptTerminalStatus(json.status)) {
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
  const gseEvidence = data?.results?.gseEvidence || [];
  const incidentalFindings = data?.results?.incidentalFindings || [];
  const activationTransitions = data?.results?.activationTransitions || [];
  const nodeOutcomes = data?.results?.nodeOutcomes || [];
  const nodeLabelById = new Map(
    gseEvidence.map((item) => [item.nodeId, item.descriptor || "Grammar pattern"])
  );
  const uniqueNodes = Array.from(
    new Map(gseEvidence.map((item) => [item.nodeId, item])).values()
  ).slice(0, 6);
  const isCompleted = data?.status === ATTEMPT_STATUS.COMPLETED;
  const isFailed = data?.status === ATTEMPT_STATUS.FAILED;
  const isNeedsRetry = Boolean(data?.status && isAttemptRetryStatus(data.status));
  const isBusy = !error && (!data || !isAttemptTerminalStatus(data.status));
  const overallScore = data?.results?.scores?.overallScore;
  const busyHint = PROCESSING_HINTS[busyHintIndex % PROCESSING_HINTS.length];
  const statusLabel = data?.status
    ? data.status.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())
    : "Starting";

  useEffect(() => {
    if (!isBusy) return;
    const interval = window.setInterval(() => {
      setBusyHintIndex((index) => index + 1);
    }, 3200);
    return () => window.clearInterval(interval);
  }, [isBusy]);

  return (
    <div className="page task-page results-page">
      <section className="task-hero results-hero">
        <div className="task-mobile-frame results-frame">
          <div className="results-floating-star" aria-hidden>
            ✦
          </div>
          <div className="results-floating-cloud" aria-hidden />

          <div className="task-top-row">
            <div className="task-nav-mini">
              <Link href="/home">Home</Link>
              <Link href="/task">Task</Link>
            </div>
          </div>

          <p className="task-kicker results-kicker">🏁 QUEST RESULTS</p>
          <h1 className="task-title-main">Great speaking work!</h1>
          <h2 className="task-title-accent results-title-accent">Let&apos;s see your magic</h2>

          {error && <p className="results-error">{error}</p>}

          <div className="results-shell">
            {isBusy && (
              <section className="results-panel results-processing-panel">
                <p className="results-status-chip">{statusLabel}</p>
                <p className="placement-loading-title">Doing some magic...</p>
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
                <p className="results-processing-hint">{busyHint}</p>
              </section>
            )}

            {isFailed && (
              <section className="results-panel results-failed-panel">
                <p className="results-failed-title">Oops! We couldn&apos;t process this recording.</p>
                <p className="results-failed-text">
                  {data?.error?.message || "Unknown error"} {data?.error?.code ? `(${data.error.code})` : ""}
                </p>
                <div className="results-actions">
                  <Link className="btn task-start-btn results-main-btn" href="/record">
                    🎙️ Try again
                  </Link>
                  <Link className="btn ghost results-secondary-btn" href="/task">
                    Back to tasks
                  </Link>
                </div>
              </section>
            )}

            {isNeedsRetry && (
              <section className="results-panel results-failed-panel results-retry-panel">
                <div className="results-retry-hero" aria-hidden>
                  <span className="results-retry-icon">Oops!</span>
                </div>
                <p className="results-retry-big">
                  {retryHeadline(data?.retry?.reasonCode || data?.error?.code)}
                </p>
                <div className="results-actions">
                  <Link className="btn task-start-btn results-main-btn" href="/record">
                    🎙️ Try again
                  </Link>
                  <Link className="btn ghost results-secondary-btn" href="/task">
                    Back to tasks
                  </Link>
                </div>
              </section>
            )}

            {isCompleted && (
              <>
                <section className="results-panel results-celebrate-panel">
                  <p className="results-status-chip">
                    {data?.flow?.isPlacement ? "Placement quest complete" : "Quest complete"}
                  </p>
                  <div className="results-score-row">
                    <div className="results-score-bubble">{overallScore != null ? Math.round(overallScore) : "⭐"}</div>
                    <div className="results-score-copy">
                      <p className="results-panel-title">You did awesome!</p>
                      {feedback?.summary ? (
                        <p className="results-summary-text">{feedback.summary}</p>
                      ) : (
                        <p className="results-summary-text">
                          Your answer is ready, and we prepared ideas for your next speaking quest.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                {metricCards.length > 0 && (
                  <section className="results-panel">
                    <p className="results-panel-title">Score board</p>
                    <div className="results-metric-grid">
                      {metricCards.map((metric) => (
                        <article className="results-metric-card" key={metric.key}>
                          <p className="results-metric-label">{metric.label}</p>
                          <p className="results-metric-value">{Math.round(metric.value)}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                {transcript && (
                  <section className="results-panel">
                    <p className="results-panel-title">What you said</p>
                    <p className="results-transcript">{transcript}</p>
                  </section>
                )}

                {(feedback?.whatWentWell?.length || feedback?.whatToFixNow?.length) && (
                  <section className="results-panel">
                    <div className="results-grid-two">
                      {(feedback?.whatWentWell || []).length > 0 && (
                        <article className="results-mini-card">
                          <p className="results-mini-title">What went well</p>
                          <ul className="results-list">
                            {(feedback?.whatWentWell || []).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </article>
                      )}
                      {(feedback?.whatToFixNow || []).length > 0 && (
                        <article className="results-mini-card">
                          <p className="results-mini-title">Improve next</p>
                          <ul className="results-list">
                            {(feedback?.whatToFixNow || []).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </article>
                      )}
                    </div>
                  </section>
                )}

                {(feedback?.exampleBetterAnswer || feedback?.nextMicroTask) && (
                  <section className="results-panel">
                    <div className="results-mini-stack">
                      {feedback?.exampleBetterAnswer && (
                        <article className="results-mini-card">
                          <p className="results-mini-title">Coach example</p>
                          <p className="results-summary-text">{feedback.exampleBetterAnswer}</p>
                        </article>
                      )}
                      {feedback?.nextMicroTask && (
                        <article className="results-mini-card">
                          <p className="results-mini-title">Next mini quest</p>
                          <p className="results-summary-text">{feedback.nextMicroTask}</p>
                        </article>
                      )}
                    </div>
                  </section>
                )}

                <details className="results-extra">
                  <summary>More details</summary>
                  <div className="results-extra-body">
                    {artifactEntries.length > 0 && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">Task facts</p>
                        <ul className="results-list">
                          {artifactEntries.map(([key, value]) => (
                            <li key={key}>
                              {displayArtifactLabel(key)}: {renderArtifactValue(value)}
                            </li>
                          ))}
                        </ul>
                      </article>
                    )}

                    {uniqueNodes.length > 0 && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">I can nodes (GSE)</p>
                        <ul className="results-list">
                          {uniqueNodes.map((node) => (
                            <li key={node.nodeId}>{node.descriptor}</li>
                          ))}
                        </ul>
                      </article>
                    )}

                    {nodeOutcomes.length > 0 && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">Node mastery updates</p>
                        <ul className="results-list">
                          {nodeOutcomes.slice(0, 8).map((item) => (
                            <li key={`${item.nodeId}-${item.evidenceCount}`}>
                              {nodeLabelById.get(item.nodeId) || "Learning node"}:{" "}
                              {item.deltaMastery >= 0 ? "+" : ""}
                              {item.deltaMastery.toFixed(1)} (decay impact {item.decayImpact.toFixed(1)})
                            </li>
                          ))}
                        </ul>
                      </article>
                    )}

                    {(incidentalFindings.length > 0 || activationTransitions.length > 0) && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">Detected new advanced usage</p>
                        {incidentalFindings.length > 0 && (
                          <ul className="results-list">
                            {incidentalFindings.slice(0, 8).map((item) => (
                              <li key={`inc-${item.nodeId}-${item.signal}`}>
                                {item.nodeLabel} ({item.domain}) - confidence{" "}
                                {(item.confidence * 100).toFixed(0)}%
                              </li>
                            ))}
                          </ul>
                        )}
                        {activationTransitions.length > 0 && (
                          <>
                            <p className="results-summary-text">Need verification:</p>
                            <ul className="results-list">
                              {activationTransitions.slice(0, 8).map((item) => (
                                <li key={`tr-${item.nodeId}`}>
                                  {nodeLabelById.get(item.nodeId) || item.nodeId}:{" "}
                                  {item.activationStateBefore || "n/a"} {" -> "}
                                  {item.activationStateAfter || "n/a"} ({item.activationImpact})
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </article>
                    )}

                    {data?.results?.planner && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">Why this task now</p>
                        {data.results.planner.selectionReason && (
                          <p className="results-summary-text">{data.results.planner.selectionReason}</p>
                        )}
                        <p className="results-summary-text">
                          Goal: {data.results.planner.primaryGoal || "n/a"} | Expected gain:{" "}
                          {typeof data.results.planner.expectedGain === "number"
                            ? data.results.planner.expectedGain.toFixed(2)
                            : "n/a"}
                        </p>
                      </article>
                    )}

                    {data?.results?.recoveryTriggered && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">Recovery mode</p>
                        <p className="results-summary-text">
                          Activated temporary recovery path. Next tasks will be shorter and more guided.
                        </p>
                      </article>
                    )}

                    {checks.length > 0 && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">Rubric checks</p>
                        <ul className="results-list">
                          {checks.map((check) => (
                            <li key={check.name}>
                              {check.pass ? "Pass" : "Fix"}: {check.reason}
                            </li>
                          ))}
                        </ul>
                      </article>
                    )}

                    {Boolean(data?.results?.debug) && (
                      <article className="results-mini-card">
                        <p className="results-mini-title">AI debug (temporary)</p>
                        <pre className="results-debug">{JSON.stringify(data.results!.debug, null, 2)}</pre>
                      </article>
                    )}
                  </div>
                </details>

                <div className="results-actions">
                  <Link className="btn task-start-btn results-main-btn" href="/task">
                    🚀 Next quest
                  </Link>
                  <Link className="btn ghost results-secondary-btn" href="/record">
                    🎙️ Retry this one
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
