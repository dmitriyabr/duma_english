"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function TeacherSignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/teacher/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sign up failed");
      router.push("/teacher");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <div className="container">
          <div className="card" style={{ maxWidth: 420, margin: "0 auto" }}>
            <h1 className="title">Create teacher account</h1>
            <p className="subtitle">Register to create classes and manage students.</p>
            <div className="spacer" />
            <form onSubmit={handleSubmit} className="grid">
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.edu"
                  required
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </div>
              {error && <p style={{ color: "var(--accent-1)" }}>{error}</p>}
              <button className="btn" type="submit" disabled={loading}>
                {loading ? "Creating account…" : "Sign up"}
              </button>
            </form>
            <p className="subtitle" style={{ marginTop: "1rem" }}>
              Already have an account? <Link href="/teacher/login">Sign in</Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
