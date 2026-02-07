"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Progress = {
  stage?: string;
  placementStage?: string;
  promotionStage?: string;
  streak: number;
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
};

type StudentProfile = {
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

export default function TeacherStudentProfilePage() {
  const params = useParams();
  const studentId = params.studentId as string;
  const [data, setData] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const { student, progress, recentAttempts } = data;
  const np = progress.nodeProgress;
  const pr = progress.promotionReadiness;

  return (
    <div className="page">
      <nav className="nav">
        <Link href={`/teacher/classes/${student.classId}`}>← {student.className}</Link>
      </nav>
      <section className="hero">
        <div className="container">
          <h1 className="title">{student.displayName}</h1>
          <p className="subtitle">
            {student.className} · Joined {formatDate(student.createdAt)}
          </p>
          <div className="spacer" />

          {/* Overview */}
          <div className="grid three" style={{ marginBottom: 24 }}>
            <div className="metric">
              <span>Stage</span>
              <strong>{progress.stage ?? "—"}</strong>
            </div>
            <div className="metric">
              <span>Streak</span>
              <strong>{progress.streak} days</strong>
            </div>
            <div className="metric">
              <span>Last attempt</span>
              <strong>
                {progress.recentAttempts?.[0]?.createdAt
                  ? formatDate(progress.recentAttempts[0].createdAt)
                  : "—"}
              </strong>
            </div>
          </div>

          {/* Path to next level (GSE nodes breakdown) */}
          {pr && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 8 }}>
                Path to next level
              </h2>
              <p className="subtitle" style={{ marginBottom: 16 }}>
                How far the student is from promotion, by GSE bundle (vocab, grammar, can-do). Nodes need mastery ≥70 and verified status to count.
              </p>

              {/* Current → Target with progress */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
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
                        width: `${Math.min(100, Math.max(0, pr.readinessScore ?? pr.coverageRatio ?? 0))}%`,
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
              <p className="subtitle" style={{ marginBottom: 16, fontSize: "0.95rem" }}>
                {pr.ready
                  ? `Ready for promotion to ${pr.targetStage}.`
                  : `Progress: ${Math.round(pr.readinessScore ?? pr.coverageRatio ?? 0)}% toward ${pr.targetStage}.`}
              </p>
              {!pr.ready && (
                <p className="subtitle" style={{ marginBottom: 16, fontSize: "0.9rem", color: "var(--ink-2)" }}>
                  The percentage is from bundle-level metrics: coverage (nodes at 70+), reliability, 14-day stability, and direct evidence. So even with 0 nodes at 70 yet, you can see a small % from other signals.
                </p>
              )}

              {/* Achieved for target stage (X/Y nodes per bundle) */}
              {(pr.targetStageBundleProgress ?? []).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <strong style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem" }}>
                    Achieved for {pr.targetStage} (nodes at 70+ and verified)
                  </strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                    {(pr.targetStageBundleProgress ?? []).map((b) => (
                      <div
                        key={b.bundleKey}
                        style={{
                          padding: "8px 12px",
                          background: b.ready ? "rgba(45,212,160,0.12)" : "rgba(16,22,47,0.05)",
                          borderRadius: "var(--radius-sm)",
                          fontSize: "0.9rem",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{b.title}</span>
                        <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>
                          {b.coveredCount} / {b.totalRequired}
                        </span>
                        {b.ready && <span style={{ marginLeft: 6, color: "#0d9668" }}>✓</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blocked bundles with node breakdown */}
              {!pr.ready && (pr.blockedBundlesReadable ?? pr.blockedBundles ?? []).length > 0 && (
                <div style={{ borderTop: "1px solid rgba(16,22,47,0.08)", paddingTop: 16 }}>
                  <strong style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem" }}>
                    Blocking GSE nodes (by bundle)
                  </strong>
                  <p className="subtitle" style={{ marginTop: 4, marginBottom: 12, fontSize: "0.9rem" }}>
                    Nodes below threshold (70) or not yet verified. Bar shows current mastery.
                  </p>
                  {(pr.blockedBundlesReadable ?? pr.blockedBundles ?? []).map((bundle) => (
                    <div
                      key={bundle.bundleKey}
                      style={{
                        marginBottom: 16,
                        padding: 12,
                        background: "rgba(16,22,47,0.03)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.95rem" }}>
                          {bundle.title}
                        </span>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--ink-2)",
                            textTransform: "capitalize",
                          }}
                        >
                          {bundle.domain}
                        </span>
                        {"reasonLabel" in bundle && typeof (bundle as { reasonLabel?: string }).reasonLabel === "string" && (
                          <span style={{ fontSize: "0.8rem", color: "var(--accent-1)" }}>
                            ({(bundle as { reasonLabel: string }).reasonLabel})
                          </span>
                        )}
                      </div>
                      <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                        {(bundle.blockers ?? []).map((node) => {
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
                              <span style={{ minWidth: 100 }}>{node.descriptor}</span>
                              <div
                                style={{
                                  flex: 1,
                                  maxWidth: 200,
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
                              <span style={{ minWidth: 32, color: "var(--ink-2)", fontWeight: 600 }}>
                                {Math.round(node.value)}
                              </span>
                              <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>{"/ 70"}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent node mastery updates (same as student sees) */}
          {(data.recentNodeOutcomes ?? []).length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
                Node mastery updates (from recent attempts)
              </h2>
              <p className="subtitle" style={{ marginBottom: 12 }}>
                Format: <strong>before → after (+delta)</strong>. The number after the arrow is the mastery right after that attempt; it matches the &quot;Full skillset&quot; table below (current value for that node).
              </p>
              <ul style={{ listStyle: "none", paddingLeft: 0 }}>
                {(data.recentNodeOutcomes ?? []).slice(0, 50).map((item, i) => (
                  <li key={`${item.nodeId}-${i}`} style={{ padding: "4px 0", color: "var(--ink-2)", fontFamily: "var(--font-body)" }}>
                    {item.descriptor}
                    {item.stage ? <span style={{ color: "var(--ink-3)", fontWeight: 500 }}> ({item.stage})</span> : null}:{" "}
                    {typeof item.previousMean === "number" && typeof item.nextMean === "number"
                      ? `${Math.round(item.previousMean)} → ${Math.round(item.nextMean)} (+${item.deltaMastery.toFixed(1)})`
                      : `${item.deltaMastery >= 0 ? "+" : ""}${item.deltaMastery.toFixed(1)}`}
                    {" "}(decay impact {item.decayImpact.toFixed(1)})
                  </li>
                ))}
              </ul>
              {(data.recentNodeOutcomes ?? []).length > 50 && (
                <p className="subtitle" style={{ marginTop: 8 }}>… and {(data.recentNodeOutcomes ?? []).length - 50} more</p>
              )}
            </div>
          )}

          {/* Full skillset (node mastery) */}
          {(data.fullMastery ?? []).length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
                Full skillset (node mastery)
              </h2>
              <p className="subtitle" style={{ marginBottom: 12 }}>
                All GSE nodes with evidence for this student. Sorted by last update.
              </p>
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
                    {(data.fullMastery ?? []).map((m) => (
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

          {/* Recent attempts */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 16 }}>
              Recent attempts
            </h2>
            {recentAttempts.length === 0 ? (
              <p className="subtitle">No completed attempts yet.</p>
            ) : (
              <ul style={{ listStyle: "none" }}>
                {recentAttempts.slice(0, 10).map((a) => (
                  <li
                    key={a.id}
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid rgba(16,22,47,0.06)",
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <span>{a.taskType}</span>
                    <span style={{ color: "var(--ink-2)" }}>{formatDate(a.createdAt)}</span>
                    <span>
                      Score:{" "}
                      {typeof (a.scores as { overallScore?: number })?.overallScore === "number"
                        ? Math.round((a.scores as { overallScore: number }).overallScore)
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* GSE: next targets */}
          {np && (np.nextTargetNodes?.length ?? 0) > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
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
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
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
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
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

          {/* Promotion readiness */}
          {pr && (
            <div className="card">
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
                Stage promotion
              </h2>
              <p className="subtitle" style={{ marginBottom: 8 }}>
                Current: {pr.currentStage} → Target: {pr.targetStage}.{" "}
                {pr.ready ? "Ready for promotion." : "Not yet ready."}
              </p>
              {pr.blockedByNodeDescriptors && pr.blockedByNodeDescriptors.length > 0 && (
                <p className="subtitle" style={{ fontSize: "0.95rem" }}>
                  Blocked by: {pr.blockedByNodeDescriptors.slice(0, 5).join(", ")}
                </p>
              )}
            </div>
          )}

          {!np?.nextTargetNodes?.length &&
            !np?.verificationQueue?.length &&
            !progress.overdueNodes?.length &&
            !pr && (
              <div className="card">
                <p className="subtitle">No GSE node details yet. More attempts will build the profile.</p>
              </div>
            )}
        </div>
      </section>
    </div>
  );
}
