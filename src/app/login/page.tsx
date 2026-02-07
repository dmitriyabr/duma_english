"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [ageBand, setAgeBand] = useState("9-11");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, ageBand }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Login failed");
      }
      router.push("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <div className="container">
          <div className="card" style={{ maxWidth: 420, margin: "0 auto" }}>
            <h1 className="title">Student Login</h1>
            <p className="subtitle">
              Enter your personal code (from your teacher). You will always return to your profile with this code.
            </p>
            <div className="spacer" />
            <form onSubmit={handleSubmit} className="grid">
              <div className="field">
                <label>Your code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  required
                />
              </div>
              <div className="field">
                <label>Age group</label>
                <select
                  value={ageBand}
                  onChange={(e) => setAgeBand(e.target.value)}
                >
                  <option value="6-8">6-8</option>
                  <option value="9-11">9-11</option>
                  <option value="12-14">12-14</option>
                </select>
              </div>
              {error && <p style={{ color: "var(--accent-1)" }}>{error}</p>}
              <button className="btn" type="submit" disabled={loading}>
                {loading ? "Signing in…" : "Start"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
