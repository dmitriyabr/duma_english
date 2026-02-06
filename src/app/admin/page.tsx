"use client";

import { useState } from "react";

export default function AdminPage() {
  const [teacherName, setTeacherName] = useState("");
  const [className, setClassName] = useState("");
  const [classId, setClassId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function createClass(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setCode("");
    try {
      const res = await fetch("/api/admin/class", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherName, className }),
      });
      if (!res.ok) throw new Error("Failed to create class");
      const json = await res.json();
      setClassId(json.classId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create class");
    }
  }

  async function generateCode() {
    setError(null);
    setCode("");
    try {
      const res = await fetch("/api/admin/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      });
      if (!res.ok) throw new Error("Failed to generate code");
      const json = await res.json();
      setCode(json.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate code");
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <div className="container">
          <div className="card" style={{ maxWidth: 620, margin: "0 auto" }}>
            <h1 className="title">Teacher Admin</h1>
            <p className="subtitle">
              Create a class and generate a code for students.
            </p>
            <div className="spacer" />
            <form onSubmit={createClass} className="grid">
              <div className="field">
                <label>Teacher name</label>
                <input
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Class name</label>
                <input
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  required
                />
              </div>
              <button className="btn" type="submit">
                Create class
              </button>
            </form>
            {classId && (
              <>
                <div className="spacer" />
                <div className="metric">
                  <span>Class ID</span>
                  <strong>{classId}</strong>
                  <button className="btn secondary" onClick={generateCode}>
                    Generate code
                  </button>
                </div>
              </>
            )}
            {code && (
              <>
                <div className="spacer" />
                <div className="metric">
                  <span>Class code</span>
                  <strong>{code}</strong>
                </div>
              </>
            )}
            {error && <p style={{ color: "#c1121f" }}>{error}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
