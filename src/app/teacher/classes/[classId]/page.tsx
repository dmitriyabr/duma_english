"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type Student = {
  id: string;
  displayName: string;
  createdAt: string;
  loginCode: string | null;
  lastAttemptAt: string | null;
  lastScore: number | null;
  stage: string;
};

type ClassData = {
  id: string;
  name: string;
  createdAt: string;
  students: Student[];
  codes: Code[];
};

type Code = {
  id: string;
  code: string;
  expiresAt: string | null;
  usesCount: number;
  maxUses: number | null;
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function TeacherClassPage() {
  const params = useParams();
  const router = useRouter();
  const classId = params.classId as string;
  const [data, setData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [copyDoneId, setCopyDoneId] = useState<string | null>(null);
  const [generatingCodeFor, setGeneratingCodeFor] = useState<string | null>(null);
  const [newStudentCode, setNewStudentCode] = useState<{ id: string; code: string } | null>(null);

  function load() {
    setError(null);
    fetch(`/api/teacher/classes/${classId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Class not found");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [classId]);

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    setError(null);
    setNewStudentCode(null);
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: addName.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setAddName("");
      if (d.loginCode) setNewStudentCode({ id: d.id, code: d.loginCode });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  async function generateCodeForStudent(studentId: string) {
    setGeneratingCodeFor(studentId);
    setError(null);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/code`, {
        method: "POST",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setGeneratingCodeFor(null);
    }
  }

  function copyCode(code: string, studentId: string) {
    navigator.clipboard.writeText(code);
    setCopyDoneId(studentId);
    setTimeout(() => setCopyDoneId(null), 2000);
  }

  if (loading) {
    return (
      <div className="page" style={{ justifyContent: "center", alignItems: "center" }}>
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <nav className="nav">
          <Link href="/teacher">← Back to classes</Link>
        </nav>
        <section className="hero">
          <div className="container">
            <p style={{ color: "var(--accent-1)" }}>{error}</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <nav className="nav">
        <Link href="/teacher">← My classes</Link>
      </nav>
      <section className="hero">
        <div className="container">
          <h1 className="title">{data?.name ?? "Class"}</h1>
          <p className="subtitle">
            Each student has a personal code. They use it on the login page and always return to their profile.
          </p>
          <div className="spacer" />

          {newStudentCode && (
            <div className="card" style={{ marginBottom: 24, background: "rgba(0,166,251,0.08)" }}>
              <p className="subtitle" style={{ marginBottom: 8 }}>
                New student added. Give them this code to log in:
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <strong
                  style={{
                    fontFamily: "monospace",
                    fontSize: "1.25rem",
                    letterSpacing: "0.1em",
                    padding: "8px 16px",
                    background: "rgba(16,22,47,0.06)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {newStudentCode.code}
                </strong>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => copyCode(newStudentCode.code, newStudentCode.id)}
                >
                  {copyDoneId === newStudentCode.id ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {error && <p style={{ color: "var(--accent-1)", marginBottom: 16 }}>{error}</p>}

          {/* Add student */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
              Add student
            </h2>
            <form onSubmit={addStudent} className="grid" style={{ maxWidth: 320 }}>
              <div className="field">
                <label>Student name</label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Name"
                  disabled={adding}
                />
              </div>
              <button className="btn" type="submit" disabled={adding || !addName.trim()}>
                {adding ? "Adding…" : "Add student"}
              </button>
            </form>
          </div>

          {/* Students list */}
          <div className="card">
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 16 }}>
              Students ({data?.students?.length ?? 0})
            </h2>
            {!data?.students?.length ? (
              <p className="subtitle">No students yet. Add one above.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(16,22,47,0.1)" }}>
                      <th style={{ padding: "10px 12px" }}>Name</th>
                      <th style={{ padding: "10px 12px" }}>Personal code</th>
                      <th style={{ padding: "10px 12px" }}>Stage</th>
                      <th style={{ padding: "10px 12px" }}>Last attempt</th>
                      <th style={{ padding: "10px 12px" }}>Last score</th>
                      <th style={{ padding: "10px 12px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((s) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid rgba(16,22,47,0.06)" }}>
                        <td style={{ padding: "12px" }}>{s.displayName}</td>
                        <td style={{ padding: "12px" }}>
                          {s.loginCode ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontFamily: "monospace", letterSpacing: "0.05em" }}>
                                {s.loginCode}
                              </span>
                              <button
                                type="button"
                                className="btn ghost"
                                style={{ padding: "4px 8px", fontSize: "0.85rem" }}
                                onClick={() => copyCode(s.loginCode!, s.id)}
                              >
                                {copyDoneId === s.id ? "Copied!" : "Copy"}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn ghost"
                              style={{ padding: "4px 8px", fontSize: "0.85rem" }}
                              onClick={() => generateCodeForStudent(s.id)}
                              disabled={generatingCodeFor === s.id}
                            >
                              {generatingCodeFor === s.id ? "…" : "Generate code"}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: "12px" }}>{s.stage}</td>
                        <td style={{ padding: "12px", color: "var(--ink-2)" }}>
                          {formatDate(s.lastAttemptAt)}
                        </td>
                        <td style={{ padding: "12px" }}>
                          {s.lastScore != null ? Math.round(s.lastScore) : "—"}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <Link href={`/teacher/students/${s.id}`} className="btn ghost" style={{ padding: "6px 12px", fontSize: "0.9rem" }}>
                            Profile
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
