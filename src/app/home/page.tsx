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
  const stageLabel = data?.stage || "A0";
  const lastScoreLabel = typeof lastScore === "number" ? Math.round(lastScore) : "--";
  const streakLabel = data ? `${data.streak} days` : "--";

  return (
    <div className="page task-page home-page">
      <section className="task-hero home-hero">
        <div className="task-mobile-frame home-frame">
          <div className="home-floating-star" aria-hidden>
            ★
          </div>
          <div className="home-floating-cloud" aria-hidden />

          <div className="task-top-row">
            <div className="task-nav-mini">
              <Link href="/task">Task</Link>
              <Link href="/progress">Progress</Link>
            </div>
          </div>

          <p className="task-kicker home-kicker">🌟 WELCOME BACK</p>
          <h1 className="task-title-main">Ready for today&apos;s</h1>
          <h2 className="task-title-accent home-title-accent">Speaking Adventure?</h2>

          {error && (
            <p className="home-error">
              {error} <Link href="/login">Login</Link>
            </p>
          )}

          <div className="home-main-grid">
            <section className="home-main-left">
              <article className="home-quest-card">
                <div className="home-quest-head">
                  <div className="home-icon-circle" aria-hidden>
                    🗺️
                  </div>
                  <div>
                    <p className="home-quest-label">TODAY&apos;S QUEST:</p>
                    <p className="home-quest-text">Your next speaking task is ready. Keep the streak alive!</p>
                  </div>
                </div>
                {data?.placementNeeded && (
                  <p className="home-placement-badge">🧭 Placement quest is recommended before new tasks.</p>
                )}
              </article>

              <article className="home-recent-card">
                <p className="home-recent-title">Recent tries</p>
                {data?.recentAttempts && data.recentAttempts.length > 0 ? (
                  <div className="home-recent-list">
                    {data.recentAttempts.slice(0, 3).map((attempt, idx) => {
                      const score = attempt.scores?.overallScore;
                      return (
                        <p key={attempt.id}>
                          #{idx + 1} • {typeof score === "number" ? Math.round(score) : "--"} points
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <p className="home-recent-empty">No attempts yet. Let&apos;s start your first one!</p>
                )}
              </article>
            </section>

            <section className="home-main-right">
              <div className="home-stats-grid">
                <article className="task-stat home-stat">
                  <div className="task-stat-icon">🔥</div>
                  <p className="task-stat-title">STREAK</p>
                  <p className="task-stat-value">{streakLabel}</p>
                </article>
                <article className="task-stat home-stat">
                  <div className="task-stat-icon">🏆</div>
                  <p className="task-stat-title">LAST SCORE</p>
                  <p className="task-stat-value">{lastScoreLabel}</p>
                </article>
                <article className="task-stat home-stat">
                  <div className="task-stat-icon">⭐</div>
                  <p className="task-stat-title">STAGE</p>
                  <p className="task-stat-value">{stageLabel}</p>
                </article>
              </div>

              <div className="home-actions">
                <Link className="btn task-start-btn home-main-btn" href="/task">
                  🎤 Start a task
                </Link>
                <Link className="btn home-secondary-btn" href="/placement-extended">
                  🧭 Placement quest
                </Link>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
