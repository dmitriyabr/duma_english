"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type DomainStageInfo = {
  stage: string;
  confidence: number;
};

type Progress = {
  stage?: string;
  placementStage?: string;
  promotionStage?: string;
  streak: number;
  domainStages?: {
    vocab: DomainStageInfo;
    grammar: DomainStageInfo;
    communication: DomainStageInfo;
  };
  pronunciationScore?: number | null;
  nodeCoverageByBand?: Record<string, { mastered: number; total: number }>;
  recentAttempts: Array<{
    id: string;
    createdAt: string;
    scores?: { overallScore?: number };
  }>;
  nodeProgress?: {
    masteredNodes: number;
    inProgressNodes: number;
    observedNodesCount?: number;
    candidateNodesCount?: number;
    verifiedNodesCount?: number;
    nextTargetNodes?: Array<{ descriptor: string; masteryScore: number }>;
    verificationQueue?: Array<{ descriptor: string; dueAt?: string; domain: string }>;
  };
  overdueNodes?: Array<{ descriptor: string; daysSinceEvidence: number; decayedMastery: number }>;
  uncertainNodes?: Array<{ descriptor: string; sigma: number; mastery: number }>;
  promotionReadiness?: {
    currentStage: string;
    targetStage: string;
    ready: boolean;
    readinessScore?: number;
    coverageRatio?: number | null;
    valueProgress?: number;
    blockedByNodes?: string[];
    blockedByNodeDescriptors?: string[];
    blockedBundles?: Array<{
      bundleKey: string;
      title: string;
      domain: string;
      reason: string;
      blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
    }>;
    blockedBundlesReadable?: Array<{
      bundleKey: string;
      title: string;
      domain: string;
      reason: string;
      reasonLabel: string;
      blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
    }>;
    targetStageBundleProgress?: Array<{
      bundleKey: string;
      title: string;
      domain: string;
      coveredCount: number;
      totalRequired: number;
      ready: boolean;
      achieved?: Array<{ nodeId: string; descriptor: string; value: number }>;
    }>;
  };
};

type Attempt = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  scores: unknown;
  taskType: string;
  promptPreview: string;
};

type MasteryRow = {
  nodeId: string;
  descriptor: string;
  type: string | null;
  skill: string | null;
  masteryScore: number;
  decayedMastery: number;
  evidenceCount: number;
  directEvidenceCount: number;
  activationState: string;
  lastEvidenceAt: string | null;
  updatedAt: string;
  halfLifeDays: number | null;
  masterySigma: number | null;
};

type NodeOutcomeRow = {
  descriptor: string;
  nodeId: string;
  stage?: string;
  deltaMastery: number;
  decayImpact: number;
  previousMean?: number;
  nextMean?: number;
  attemptCreatedAt: string;
  streakMultiplier?: number;
};

type LevelNodeRow = {
  nodeId: string;
  descriptor: string;
  gseCenter: number | null;
  value: number;
  directEvidenceCount: number;
  activationState: string | null;
  status: "mastered" | "credited" | "in_progress" | "no_evidence";
  inBundle?: boolean;
};

type StudentProfile = {
  catalogNodesByBand?: Record<string, number>;
  perStageCredited?: Record<string, number>;
  perStageBundleTotal?: Record<string, number>;
  student: {
    id: string;
    displayName: string;
    createdAt: string;
    classId: string;
    className: string;
  };
  progress: Progress;
  recentAttempts: Attempt[];
  fullMastery: MasteryRow[];
  recentNodeOutcomes: NodeOutcomeRow[];
};

function formatDate(d: string) {
  return new Date(d).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const STAGE_PCT: Record<string, number> = {
  A0: 5, A1: 17, A2: 33, B1: 50, B2: 67, C1: 83, C2: 95,
};

function computeDomainStats(nodes: MasteryRow[]) {
  const now = Date.now();
  let mastered = 0, inProgress = 0, overdue = 0;
  const weakest: MasteryRow[] = [];

  for (const n of nodes) {
    const val = n.decayedMastery;
    if (val >= 70 && n.activationState === "verified") {
      mastered++;
    } else if (n.evidenceCount > 0) {
      inProgress++;
      weakest.push(n);
    }

    if (n.lastEvidenceAt) {
      const hl = n.halfLifeDays ?? 14;
      const days = (now - new Date(n.lastEvidenceAt).getTime()) / 86400000;
      if (days > hl) overdue++;
    }
  }

  weakest.sort((a, b) => a.decayedMastery - b.decayedMastery);
  return { mastered, inProgress, overdue, total: nodes.length, weakest: weakest.slice(0, 5) };
}

function confLabel(confidence: number): string {
  if (confidence >= 0.75) return "high conf";
  if (confidence >= 0.4) return "medium";
  return "low";
}

function DomainBar({ label, stage, pct, detail }: { label: string; stage: string; pct: number; detail: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
      <span style={{ minWidth: 120, fontWeight: 500, fontSize: "0.95rem" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "0.95rem",
          minWidth: 32,
          textAlign: "center",
          padding: "2px 8px",
          background: "rgba(16,22,47,0.06)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        {stage}
      </span>
      <div style={{ flex: 1, height: 10, borderRadius: 999, background: "rgba(16,22,47,0.1)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(2, pct))}%`,
            background: "linear-gradient(90deg, var(--accent-3), var(--accent-2))",
            borderRadius: 999,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ minWidth: 80, fontSize: "0.85rem", color: "var(--ink-2)", textAlign: "right" }}>{detail}</span>
    </div>
  );
}

function DomainFocusCard({
  title,
  stage,
  stats,
}: {
  title: string;
  stage: string;
  stats: ReturnType<typeof computeDomainStats>;
}) {
  return (
    <div className="card" style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", margin: 0 }}>{title}</h3>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "1rem",
            padding: "2px 10px",
            background: "rgba(99,102,241,0.12)",
            color: "#4f46e5",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {stage}
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: "0.85rem", color: "var(--ink-2)", marginBottom: 14, flexWrap: "wrap" }}>
        <span><strong style={{ color: "#0d9668" }}>{stats.mastered}</strong> mastered</span>
        <span><strong>{stats.inProgress}</strong> in progress</span>
        {stats.overdue > 0 && (
          <span><strong style={{ color: "var(--accent-1)" }}>{stats.overdue}</strong> overdue</span>
        )}
      </div>

      {stats.weakest.length > 0 && (
        <>
          <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: 8 }}>Needs work</p>
          <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
            {stats.weakest.map((n) => (
              <li
                key={n.nodeId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {n.descriptor}
                </span>
                <div style={{ width: 80, height: 6, borderRadius: 999, background: "rgba(16,22,47,0.1)", overflow: "hidden", flexShrink: 0 }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.max(2, (n.decayedMastery / 70) * 100))}%`,
                      background: n.decayedMastery < 30 ? "var(--accent-1)" : "var(--accent-3)",
                      borderRadius: 999,
                    }}
                  />
                </div>
                <span style={{ minWidth: 28, fontSize: "0.8rem", color: "var(--ink-2)", textAlign: "right" }}>
                  {Math.round(n.decayedMastery)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {stats.weakest.length === 0 && stats.inProgress === 0 && stats.mastered === 0 && (
        <p style={{ fontSize: "0.85rem", color: "var(--ink-3)" }}>No evidence yet in this domain.</p>
      )}
    </div>
  );
}

function BundlePill({ title, covered, total, ready }: { title: string; covered: number; total: number; ready: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: 999,
        fontSize: "0.85rem",
        fontWeight: 500,
        background: ready ? "rgba(45,212,160,0.15)" : "rgba(16,22,47,0.06)",
        color: ready ? "#0d9668" : "var(--ink-1)",
      }}
    >
      {title} {covered}/{total} {ready && "✓"}
    </span>
  );
}

export default function TeacherStudentProfilePage() {
  const params = useParams();
  const studentId = params.studentId as string;
  const [data, setData] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showBundleDetails, setShowBundleDetails] = useState(false);
  const [levelModalStage, setLevelModalStage] = useState<string | null>(null);
  const [levelModalNodes, setLevelModalNodes] = useState<LevelNodeRow[] | null>(null);
  const [levelModalLoading, setLevelModalLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/teacher/students/${studentId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Student not found");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [studentId]);

  async function openLevelModal(stage: string) {
    setLevelModalStage(stage);
    setLevelModalNodes(null);
    setLevelModalLoading(true);
    try {
      const res = await fetch(
        `/api/teacher/students/${studentId}/level-nodes?stage=${encodeURIComponent(stage)}`
      );
      if (res.ok) {
        const json = await res.json();
        setLevelModalNodes(json.nodes ?? []);
      }
    } finally {
      setLevelModalLoading(false);
    }
  }
  function closeLevelModal() {
    setLevelModalStage(null);
    setLevelModalNodes(null);
  }

  if (loading) {
    return (
      <div className="page" style={{ justifyContent: "center", alignItems: "center" }}>
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <nav className="nav">
          <Link href="/teacher">← My classes</Link>
        </nav>
        <section className="hero">
          <div className="container">
            <p style={{ color: "var(--accent-1)" }}>{error ?? "Not found"}</p>
          </div>
        </section>
      </div>
    );
  }

  const { student, progress, recentAttempts, fullMastery, catalogNodesByBand, perStageCredited, perStageBundleTotal } = data;
  const pr = progress.promotionReadiness;
  const np = progress.nodeProgress;

  // Derive domain node groups
  const domainNodes = {
    vocab: fullMastery.filter((m) => m.type === "GSE_VOCAB"),
    grammar: fullMastery.filter((m) => m.type === "GSE_GRAMMAR"),
    communication: fullMastery.filter((m) => m.type === "GSE_LO"),
  };
  const vocabStats = computeDomainStats(domainNodes.vocab);
  const grammarStats = computeDomainStats(domainNodes.grammar);
  const communicationStats = computeDomainStats(domainNodes.communication);

  const lastAttemptDate = progress.recentAttempts?.[0]?.createdAt;

  return (
    <div className="page">
      <nav className="nav">
        <Link href={`/teacher/classes/${student.classId}`}>← {student.className}</Link>
      </nav>
      <section className="hero">
        <div className="container">
          {/* Section 1: Header */}
          <h1 className="title">{student.displayName}</h1>
          <p className="subtitle">
            {student.className} · Joined {formatDate(student.createdAt)}
          </p>
          <div className="spacer" />

          {/* Section 2: Domain Snapshot Card */}
          <div className="card" style={{ marginBottom: 24, padding: "16px 20px" }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12, fontSize: "0.95rem" }}>
              <span>
                <strong style={{ fontFamily: "var(--font-display)" }}>Overall: {progress.stage ?? "—"}</strong>
              </span>
              <span style={{ color: "var(--ink-2)" }}>
                Streak: <strong>{progress.streak}</strong> days
              </span>
              <span style={{ color: "var(--ink-2)" }}>
                Last: <strong>{lastAttemptDate ? formatDateShort(lastAttemptDate) : "—"}</strong>
              </span>
            </div>

            <div style={{ borderTop: "1px solid rgba(16,22,47,0.08)", paddingTop: 12 }}>
              {progress.domainStages && (
                <>
                  <DomainBar
                    label="Vocabulary"
                    stage={progress.domainStages.vocab.stage}
                    pct={STAGE_PCT[progress.domainStages.vocab.stage] ?? 50}
                    detail={confLabel(progress.domainStages.vocab.confidence)}
                  />
                  <DomainBar
                    label="Grammar"
                    stage={progress.domainStages.grammar.stage}
                    pct={STAGE_PCT[progress.domainStages.grammar.stage] ?? 50}
                    detail={confLabel(progress.domainStages.grammar.confidence)}
                  />
                  <DomainBar
                    label="Communication"
                    stage={progress.domainStages.communication.stage}
                    pct={STAGE_PCT[progress.domainStages.communication.stage] ?? 50}
                    detail={confLabel(progress.domainStages.communication.confidence)}
                  />
                </>
              )}
              {progress.pronunciationScore != null && (
                <DomainBar
                  label="Pronunciation"
                  stage={String(Math.round(progress.pronunciationScore))}
                  pct={progress.pronunciationScore}
                  detail="/100"
                />
              )}
            </div>
          </div>

          {/* Section 3: Domain Focus Cards */}
          <div className="grid three" style={{ marginBottom: 24 }}>
            <DomainFocusCard
              title="Vocabulary"
              stage={progress.domainStages?.vocab.stage ?? "—"}
              stats={vocabStats}
            />
            <DomainFocusCard
              title="Grammar"
              stage={progress.domainStages?.grammar.stage ?? "—"}
              stats={grammarStats}
            />
            <DomainFocusCard
              title="Communication"
              stage={progress.domainStages?.communication.stage ?? "—"}
              stats={communicationStats}
            />
          </div>

          {/* Section 4: Promotion Progress */}
          {pr && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", marginBottom: 12 }}>
                Path to next level
              </h2>

              {/* Current → Target with progress */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    padding: "8px 14px",
                    background: "rgba(16,22,47,0.06)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {pr.currentStage}
                </span>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div
                    style={{
                      height: 12,
                      borderRadius: 999,
                      background: "rgba(16,22,47,0.1)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, Math.max(0, Math.max(pr.readinessScore ?? pr.coverageRatio ?? 0, (pr.valueProgress ?? 0) * 100)))}%`,
                        background: pr.ready
                          ? "linear-gradient(90deg, var(--accent-2), #2dd4a0)"
                          : "linear-gradient(90deg, var(--accent-3), var(--accent-2))",
                        borderRadius: 999,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    padding: "8px 14px",
                    background: pr.ready ? "rgba(45,212,160,0.2)" : "rgba(16,22,47,0.06)",
                    borderRadius: "var(--radius-sm)",
                    color: pr.ready ? "#0d9668" : "var(--ink-1)",
                  }}
                >
                  {pr.targetStage}
                </span>
              </div>

              <p className="subtitle" style={{ marginBottom: 12, fontSize: "0.9rem" }}>
                {pr.ready
                  ? `Ready for promotion to ${pr.targetStage}.`
                  : `Progress: ${Math.round(Math.max(pr.readinessScore ?? pr.coverageRatio ?? 0, (pr.valueProgress ?? 0) * 100))}% toward ${pr.targetStage}.`}
              </p>

              {/* Bundle summary pills */}
              {(pr.targetStageBundleProgress ?? []).length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  {(pr.targetStageBundleProgress ?? []).map((b) => (
                    <BundlePill
                      key={b.bundleKey}
                      title={b.title}
                      covered={b.coveredCount}
                      total={b.totalRequired}
                      ready={b.ready}
                    />
                  ))}
                </div>
              )}

              {/* Collapsible bundle node details */}
              {(pr.targetStageBundleProgress ?? []).length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBundleDetails(!showBundleDetails)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent-1)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    {showBundleDetails ? "Hide node details" : "Show node details"}
                  </button>

                  {showBundleDetails && (
                    <div style={{ borderTop: "1px solid rgba(16,22,47,0.08)", paddingTop: 12, marginTop: 12 }}>
                      {(pr.targetStageBundleProgress ?? []).map((b) => {
                        const blocked = (pr.blockedBundlesReadable ?? pr.blockedBundles ?? []).find(
                          (x) => x.bundleKey === b.bundleKey
                        );
                        const blockers = blocked?.blockers ?? [];
                        return (
                          <div
                            key={b.bundleKey}
                            style={{
                              marginBottom: 16,
                              padding: 12,
                              background: b.ready ? "rgba(45,212,160,0.06)" : "rgba(16,22,47,0.03)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.95rem" }}>
                                {b.title}
                              </span>
                              <span style={{ fontSize: "0.9rem", color: "var(--ink-2)" }}>
                                {b.coveredCount} / {b.totalRequired}
                              </span>
                              {b.ready && <span style={{ color: "#0d9668" }}>✓</span>}
                            </div>
                            <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                              {(b.achieved ?? []).map((node) => (
                                <li
                                  key={node.nodeId}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    marginBottom: 6,
                                    fontSize: "0.9rem",
                                  }}
                                >
                                  <span style={{ color: "#0d9668", minWidth: 24 }}>✓</span>
                                  <span style={{ minWidth: 100, flex: 1 }}>{node.descriptor}</span>
                                  <div
                                    style={{
                                      width: 200,
                                      height: 8,
                                      borderRadius: 4,
                                      background: "rgba(16,22,47,0.1)",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        background: "#0d9668",
                                        borderRadius: 4,
                                      }}
                                    />
                                  </div>
                                  <span style={{ minWidth: 40, color: "var(--ink-2)", fontWeight: 600 }}>
                                    {Math.round(node.value)} / 70
                                  </span>
                                </li>
                              ))}
                              {blockers.map((node) => {
                                const pct = Math.min(100, (node.value / 70) * 100);
                                return (
                                  <li
                                    key={node.nodeId}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 10,
                                      marginBottom: 6,
                                      fontSize: "0.9rem",
                                    }}
                                  >
                                    <span style={{ minWidth: 24 }} />
                                    <span style={{ minWidth: 100, flex: 1 }}>{node.descriptor}</span>
                                    <div
                                      style={{
                                        width: 200,
                                        height: 8,
                                        borderRadius: 4,
                                        background: "rgba(16,22,47,0.1)",
                                        overflow: "hidden",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: `${pct}%`,
                                          height: "100%",
                                          background: node.value >= 70 ? "var(--accent-2)" : "var(--accent-3)",
                                          borderRadius: 4,
                                        } as React.CSSProperties}
                                      />
                                    </div>
                                    <span style={{ minWidth: 40, color: "var(--ink-2)", fontWeight: 600 }}>
                                      {Math.round(node.value)} / 70
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Section 5: Recent Activity */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", marginBottom: 12 }}>
              Recent activity
            </h2>
            {recentAttempts.length === 0 ? (
              <p className="subtitle">No completed attempts yet.</p>
            ) : (
              <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                {recentAttempts.slice(0, 10).map((a) => (
                  <li
                    key={a.id}
                    style={{
                      padding: "8px 0",
                      borderBottom: "1px solid rgba(16,22,47,0.06)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: "0.9rem",
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: "0.8rem",
                        background: "rgba(16,22,47,0.06)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.taskType}
                    </span>
                    <span style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                      {formatDateShort(a.createdAt)}
                    </span>
                    <span style={{ fontWeight: 500 }}>
                      {typeof (a.scores as { overallScore?: number })?.overallScore === "number"
                        ? Math.round((a.scores as { overallScore: number }).overallScore)
                        : "—"}
                    </span>
                    {a.promptPreview && (
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--ink-3)",
                          fontSize: "0.85rem",
                        }}
                      >
                        {a.promptPreview}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Section 6: Detailed Diagnostics (collapsible) */}
          <div style={{ marginBottom: 24 }}>
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              style={{
                padding: "10px 20px",
                cursor: "pointer",
                border: "1px solid rgba(16,22,47,0.15)",
                borderRadius: "var(--radius-sm)",
                background: showDiagnostics ? "rgba(16,22,47,0.06)" : "white",
                fontSize: "0.9rem",
                fontWeight: 500,
                width: "100%",
                textAlign: "left",
              }}
            >
              {showDiagnostics ? "Hide detailed diagnostics" : "Show detailed diagnostics"}
            </button>

            {showDiagnostics && (
              <div style={{ marginTop: 16 }}>
                {/* By-level table */}
                {(catalogNodesByBand && Object.keys(catalogNodesByBand).length > 0) && (
                  <div className="card" style={{ marginBottom: 24, padding: "12px 16px" }}>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: 6 }}>
                      By level
                    </h2>
                    <p className="subtitle" style={{ marginBottom: 10, fontSize: "0.8rem" }}>
                      Total = nodes in catalog. Credited and % = bundle nodes (count toward next level). Click a level to see all catalog nodes.
                    </p>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid rgba(16,22,47,0.12)", color: "var(--ink-2)" }}>
                            <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>Level</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>Total</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>Credited</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>With evidence</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>Mastered</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>In progress</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>No evidence</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", width: 44 }}>%</th>
                            <th style={{ padding: "6px 8px", width: 72 }}>Bar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(["A1", "A2", "B1", "B2", "C1", "C2"] as const).map((stage) => {
                            const stat = progress.nodeCoverageByBand?.[stage] ?? { mastered: 0, total: 0 };
                            const catalogTotal = catalogNodesByBand?.[stage] ?? 0;
                            const credited = perStageCredited?.[stage] ?? 0;
                            const withEvidence = stat.total;
                            const mastered = stat.mastered;
                            const inProg = withEvidence - mastered;
                            const noEvidence = Math.max(0, catalogTotal - withEvidence);
                            const bundleTotal = perStageBundleTotal?.[stage] ?? 0;
                            const pctCatalog = bundleTotal > 0 ? Math.round((credited / bundleTotal) * 100) : 0;
                            return (
                              <tr key={stage} style={{ borderBottom: "1px solid rgba(16,22,47,0.06)" }}>
                                <td
                                  style={{
                                    padding: "6px 8px",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textDecoration: "underline",
                                    color: "var(--accent-1)",
                                  }}
                                  onClick={() => openLevelModal(stage)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => e.key === "Enter" && openLevelModal(stage)}
                                >
                                  {stage}
                                </td>
                                <td style={{ textAlign: "right", padding: "6px 8px" }}>{catalogTotal}</td>
                                <td style={{ textAlign: "right", padding: "6px 8px" }}>{credited}</td>
                                <td style={{ textAlign: "right", padding: "6px 8px" }}>{withEvidence}</td>
                                <td style={{ textAlign: "right", padding: "6px 8px" }}>{mastered}</td>
                                <td style={{ textAlign: "right", padding: "6px 8px", color: "var(--ink-2)" }}>{inProg}</td>
                                <td style={{ textAlign: "right", padding: "6px 8px", color: "var(--ink-3)" }}>{noEvidence}</td>
                                <td style={{ textAlign: "right", padding: "6px 8px" }}>{catalogTotal > 0 ? `${pctCatalog}%` : "—"}</td>
                                <td style={{ padding: "6px 8px" }}>
                                  <div
                                    style={{
                                      height: 6,
                                      borderRadius: 999,
                                      background: "rgba(16,22,47,0.1)",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: "100%",
                                        width: `${Math.min(100, pctCatalog)}%`,
                                        minWidth: credited > 0 ? 4 : 0,
                                        background: pctCatalog >= 80 ? "var(--accent-2)" : "var(--accent-3)",
                                        borderRadius: 999,
                                      }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Full skillset table */}
                {(fullMastery ?? []).length > 0 && (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: 12 }}>
                      Full skillset (node mastery)
                    </h2>
                    <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                        <thead style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", zIndex: 1 }}>
                          <tr style={{ textAlign: "left", borderBottom: "2px solid rgba(16,22,47,0.12)" }}>
                            <th style={{ padding: "8px 10px" }}>Descriptor</th>
                            <th style={{ padding: "8px 10px" }}>Type</th>
                            <th style={{ padding: "8px 10px" }}>Mastery</th>
                            <th style={{ padding: "8px 10px" }}>Decayed</th>
                            <th style={{ padding: "8px 10px" }}>Evidence</th>
                            <th style={{ padding: "8px 10px" }}>Direct</th>
                            <th style={{ padding: "8px 10px" }}>State</th>
                            <th style={{ padding: "8px 10px" }}>Last evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(fullMastery ?? []).map((m) => (
                            <tr key={m.nodeId} style={{ borderBottom: "1px solid rgba(16,22,47,0.06)" }}>
                              <td style={{ padding: "8px 10px" }}>{m.descriptor}</td>
                              <td style={{ padding: "8px 10px", color: "var(--ink-2)" }}>{m.type ?? "—"}</td>
                              <td style={{ padding: "8px 10px" }}>{Math.round(m.masteryScore)}</td>
                              <td style={{ padding: "8px 10px" }}>{Math.round(m.decayedMastery)}</td>
                              <td style={{ padding: "8px 10px" }}>{m.evidenceCount}</td>
                              <td style={{ padding: "8px 10px" }}>{m.directEvidenceCount}</td>
                              <td style={{ padding: "8px 10px", fontSize: "0.85rem" }}>{m.activationState}</td>
                              <td style={{ padding: "8px 10px", color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                                {m.lastEvidenceAt ? formatDate(m.lastEvidenceAt) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Recent node mastery updates */}
                {(data.recentNodeOutcomes ?? []).length > 0 && (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: 12 }}>
                      Node mastery updates (recent)
                    </h2>
                    <ul style={{ listStyle: "none", paddingLeft: 0 }}>
                      {(data.recentNodeOutcomes ?? []).slice(0, 50).map((item, i) => (
                        <li key={`${item.nodeId}-${i}`} style={{ padding: "4px 0", color: "var(--ink-2)", fontFamily: "var(--font-body)" }}>
                          {item.descriptor}
                          {item.stage ? <span style={{ color: "var(--ink-3)", fontWeight: 500 }}> ({item.stage})</span> : null}:{" "}
                          {typeof item.previousMean === "number" && typeof item.nextMean === "number"
                            ? `${Math.round(item.previousMean)} → ${Math.round(item.nextMean)} (+${item.deltaMastery.toFixed(1)})`
                            : `${item.deltaMastery >= 0 ? "+" : ""}${item.deltaMastery.toFixed(1)}`}
                          {" "}(decay impact {item.decayImpact.toFixed(1)})
                          {typeof item.streakMultiplier === "number"
                            ? ` · streak ×${item.streakMultiplier.toFixed(2)}`
                            : null}
                        </li>
                      ))}
                    </ul>
                    {(data.recentNodeOutcomes ?? []).length > 50 && (
                      <p className="subtitle" style={{ marginTop: 8 }}>… and {(data.recentNodeOutcomes ?? []).length - 50} more</p>
                    )}
                  </div>
                )}

                {/* Next targets */}
                {np && (np.nextTargetNodes?.length ?? 0) > 0 && (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: 12 }}>
                      Focus (next targets)
                    </h2>
                    <ul style={{ listStyle: "none" }}>
                      {np.nextTargetNodes!.slice(0, 8).map((n, i) => (
                        <li key={i} style={{ padding: "6px 0", color: "var(--ink-2)" }}>
                          {n.descriptor} (mastery: {Math.round(n.masteryScore)})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Verification queue */}
                {np && (np.verificationQueue?.length ?? 0) > 0 && (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: 12 }}>
                      Verification queue
                    </h2>
                    <ul style={{ listStyle: "none" }}>
                      {np.verificationQueue!.slice(0, 8).map((n, i) => (
                        <li key={i} style={{ padding: "6px 0", color: "var(--ink-2)" }}>
                          {n.descriptor} ({n.domain})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Overdue */}
                {progress.overdueNodes && progress.overdueNodes.length > 0 && (
                  <div className="card" style={{ marginBottom: 24 }}>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", marginBottom: 12 }}>
                      Overdue for review
                    </h2>
                    <ul style={{ listStyle: "none" }}>
                      {progress.overdueNodes.slice(0, 8).map((n, i) => (
                        <li key={i} style={{ padding: "6px 0", color: "var(--ink-2)" }}>
                          {n.descriptor} · {n.daysSinceEvidence} days · mastery {Math.round(n.decayedMastery)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Level nodes modal */}
          {levelModalStage != null && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(16,22,47,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: 24,
              }}
              onClick={closeLevelModal}
              role="dialog"
              aria-modal="true"
              aria-label={`Level ${levelModalStage} nodes`}
            >
              <div
                className="card"
                style={{
                  maxWidth: 640,
                  maxHeight: "80vh",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  padding: 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(16,22,47,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", margin: 0 }}>
                    Level {levelModalStage} — all nodes
                  </h3>
                  <button
                    type="button"
                    onClick={closeLevelModal}
                    style={{
                      padding: "6px 12px",
                      cursor: "pointer",
                      border: "1px solid rgba(16,22,47,0.2)",
                      borderRadius: "var(--radius-sm)",
                      background: "white",
                      fontSize: "0.9rem",
                    }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ overflow: "auto", flex: 1, padding: 16 }}>
                  {levelModalLoading ? (
                    <p className="subtitle">Loading…</p>
                  ) : levelModalNodes ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(16,22,47,0.12)", color: "var(--ink-2)" }}>
                          <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Descriptor</th>
                          <th style={{ textAlign: "center", padding: "8px", width: 70 }}>Path</th>
                          <th style={{ textAlign: "left", padding: "8px", width: 100 }}>Status</th>
                          <th style={{ textAlign: "right", padding: "8px", width: 56 }}>Value</th>
                          <th style={{ textAlign: "right", padding: "8px", width: 56 }}>Direct</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...levelModalNodes]
                          .sort((a, b) => {
                            const byValue = b.value - a.value;
                            if (byValue !== 0) return byValue;
                            return (b.inBundle ? 1 : 0) - (a.inBundle ? 1 : 0);
                          })
                          .map((n) => (
                          <tr key={n.nodeId} style={{ borderBottom: "1px solid rgba(16,22,47,0.06)" }}>
                            <td style={{ padding: "8px", color: "var(--ink-1)" }} title={n.descriptor}>
                              {(n.descriptor || n.nodeId).slice(0, 60)}
                              {(n.descriptor?.length ?? 0) > 60 ? "…" : ""}
                            </td>
                            <td style={{ padding: "8px", textAlign: "center" }}>
                              {n.inBundle ? (
                                <span style={{ fontSize: "0.75rem", color: "var(--accent-1)", fontWeight: 600 }} title="Counts toward next level">✓</span>
                              ) : (
                                <span style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: "8px" }}>
                              <span
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  fontSize: "0.8rem",
                                  background:
                                    n.status === "mastered"
                                      ? "rgba(45,212,160,0.2)"
                                      : n.status === "credited"
                                        ? "rgba(99,102,241,0.15)"
                                        : n.status === "in_progress"
                                          ? "rgba(16,22,47,0.08)"
                                          : "rgba(16,22,47,0.04)",
                                  color:
                                    n.status === "mastered"
                                      ? "#0d9668"
                                      : n.status === "credited"
                                        ? "#4f46e5"
                                        : "var(--ink-2)",
                                }}
                              >
                                {n.status}
                              </span>
                            </td>
                            <td style={{ textAlign: "right", padding: "8px" }}>{n.value}</td>
                            <td style={{ textAlign: "right", padding: "8px" }}>{n.directEvidenceCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="subtitle">No nodes.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!pr && fullMastery.length === 0 && recentAttempts.length === 0 && (
            <div className="card">
              <p className="subtitle">No data yet. More attempts will build the profile.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
