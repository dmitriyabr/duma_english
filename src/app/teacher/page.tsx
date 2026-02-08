"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ClassItem = {
  id: string;
  name: string;
  createdAt: string;
  studentCount: number;
  lastActivityAt: string | null;
};

type Me = { teacherId: string; name: string; email: string | null };

function formatDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  const now = new Date();
  const sameDay =
    dt.getDate() === now.getDate() &&
    dt.getMonth() === now.getMonth() &&
    dt.getFullYear() === now.getFullYear();
  if (sameDay) return dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return dt.toLocaleDateString();
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/teacher/me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/teacher/classes").then((r) => (r.ok ? r.json() : { classes: [] })),
    ])
      .then(([meData, classesData]) => {
        setMe(meData ?? null);
        setClasses(classesData?.classes ?? []);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch("/api/auth/teacher/logout", { method: "POST" });
    router.replace("/teacher/login");
    router.refresh();
  }

  async function createClass(e: React.FormEvent) {
    e.preventDefault();
    if (!newClassName.trim()) return;
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/teacher/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newClassName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create class");
      setClasses((prev) => [
        {
          id: data.classId,
          name: data.name,
          createdAt: new Date().toISOString(),
          studentCount: 0,
          lastActivityAt: null,
        },
        ...prev,
      ]);
      setNewClassName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="page" style={{ justifyContent: "center", alignItems: "center" }}>
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Teacher</strong>
        <div className="nav-links">
          <span style={{ color: "var(--ink-2)" }}>{me?.name ?? ""}</span>
          <Link href="/">Student app</Link>
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "8px 12px", fontSize: "0.9rem" }}
            onClick={logout}
          >
            Log out
          </button>
        </div>
      </nav>
      <section className="hero">
        <div className="container">
          <h1 className="title">My classes</h1>
          <p className="subtitle">Create a class, add students, and share the class code.</p>
          <div className="spacer" />

          <form onSubmit={createClass} className="grid" style={{ maxWidth: 400, marginBottom: 24 }}>
            <div className="field">
              <label>New class name</label>
              <input
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="e.g. 5B"
                disabled={creating}
              />
            </div>
            <button className="btn" type="submit" disabled={creating || !newClassName.trim()}>
              {creating ? "Creating…" : "Create class"}
            </button>
          </form>
          {error && <p style={{ color: "var(--accent-1)", marginBottom: 16 }}>{error}</p>}

          {classes.length === 0 ? (
            <div className="card">
              <p className="subtitle">No classes yet. Create one above.</p>
            </div>
          ) : (
            <div className="grid two" style={{ gap: 16 }}>
              {classes.map((c) => (
                <Link key={c.id} href={`/teacher/classes/${c.id}`}>
                  <div className="card" style={{ cursor: "pointer" }}>
                    <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>
                      {c.name}
                    </strong>
                    <p className="subtitle" style={{ marginTop: 8 }}>
                      {c.studentCount} student{c.studentCount !== 1 ? "s" : ""}
                    </p>
                    <p className="subtitle" style={{ marginTop: 4, fontSize: "0.9rem" }}>
                      Last activity: {formatDate(c.lastActivityAt)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
