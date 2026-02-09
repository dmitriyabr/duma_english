"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ProgressData = {
  stage?: string;
  placementNeeded?: boolean;
  streak: number;
  recentAttempts: { id: string; createdAt: string; scores: { overallScore?: number } }[];
};

export default function HomePage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/progress")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json) => {
        if (active) setData(json);
      })
      .catch(() => {
        if (active) setError("Please login to see your progress.");
      });
    return () => {
      active = false;
    };
  }, []);

  const lastScore = data?.recentAttempts?.[0]?.scores?.overallScore;

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Duma Trainer</strong>
        <div className="nav-links">
          <Link href="/task">New task</Link>
          <Link href="/progress">Progress</Link>
        </div>
      </nav>
      <section className="container">
        <div className="card">
          <h1 className="title">Welcome back</h1>
          <p className="subtitle">
            Your next speaking task is ready. Keep the streak alive.
          </p>
          <div className="spacer" />
          {error && (
            <p style={{ color: "#c1121f" }}>
              {error} <Link href="/login">Login</Link>
            </p>
          )}
          <div className="grid two">
            <div className="metric">
              <span>Streak</span>
              <strong>{data ? `${data.streak} days` : "--"}</strong>
            </div>
            <div className="metric">
              <span>Last score</span>
              <strong>{lastScore ? Math.round(lastScore) : "--"}</strong>
              {data?.stage && <p className="subtitle">Stage: {data.stage}</p>}
            </div>
          </div>
          <div className="spacer" />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn" href="/task">
              Start a task
            </Link>
            <Link className="btn ghost" href="/placement-extended">
              Take placement test
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
