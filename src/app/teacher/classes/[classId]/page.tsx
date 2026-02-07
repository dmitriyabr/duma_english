"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type Student = {
  id: string;
  displayName: string;
  createdAt: string;
  lastAttemptAt: string | null;
  lastScore: number | null;
  stage: string;
};

type Code = {
  id: string;
  code: string;
  expiresAt: string | null;
  usesCount: number;
  maxUses: number | null;
};

type ClassData = {
  id: string;
  name: string;
  createdAt: string;
  students: Student[];
  codes: Code[];
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
  const [genCode, setGenCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

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
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: addName.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      setAddName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  async function generateCode() {
    setGenerating(true);
    setError(null);
    setGenCode(null);
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setGenCode(d.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setGenerating(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
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

  const displayCode = genCode ?? data?.codes?.[0]?.code ?? null;

  return (
    <div className="page">
      <nav className="nav">
        <Link href="/teacher">← My classes</Link>
      </nav>
      <section className="hero">
        <div className="container">
          <h1 className="title">{data?.name ?? "Class"}</h1>
          <p className="subtitle">Students and class code for student login.</p>
          <div className="spacer" />

          {/* Class code */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", marginBottom: 12 }}>
              Class code
            </h2>
            <p className="subtitle" style={{ marginBottom: 12 }}>
              Students use this code on the login page together with their name.
            </p>
            {displayCode ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <strong
                  style={{
                    fontFamily: "monospace",
                    fontSize: "1.5rem",
                    letterSpacing: "0.15em",
                    padding: "8px 16px",
                    background: "rgba(16,22,47,0.06)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {displayCode}
                </strong>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => copyCode(displayCode)}
                >
                  {copyDone ? "Copied!" : "Copy"}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 12 }}
              onClick={generateCode}
              disabled={generating}
            >
              {generating ? "Generating…" : "Generate new code"}
            </button>
          </div>

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
              <p className="subtitle">No students yet. Add one above or share the class code.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(16,22,47,0.1)" }}>
                      <th style={{ padding: "10px 12px" }}>Name</th>
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
