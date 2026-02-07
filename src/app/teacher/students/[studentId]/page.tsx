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
    blockedByNodeDescriptors?: string[];
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
