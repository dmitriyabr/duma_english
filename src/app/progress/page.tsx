"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Skill = {
  skillKey: string;
  current: number | null;
  delta7: number | null;
  delta28: number | null;
  trend: "up" | "down" | "flat" | "insufficient";
  reliability: "high" | "medium" | "low";
  sampleCount: number;
};

type ProgressData = {
  stage?: string;
  ageBand?: string;
  cycleWeek?: number;
  streak: number;
  focus: string | null;
  recentAttempts: { id: string; createdAt: string; scores: { overallScore?: number } }[];
  skills: Skill[];
  mastery?: Array<{
    skillKey: string;
    masteryScore: number;
    reliability: "high" | "medium" | "low";
    evidenceCount: number;
  }>;
};

function labelForSkill(skillKey: string) {
  switch (skillKey) {
    case "pronunciation":
      return "Pronunciation";
    case "fluency":
      return "Fluency";
    case "tempo_control":
      return "Tempo control";
    case "vocabulary":
      return "Vocabulary";
    case "task_completion":
      return "Task completion";
    default:
      return skillKey;
  }
}

function deltaLabel(value: number | null) {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

export default function ProgressPage() {
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
        if (active) setError("Please login to view progress.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Duma Trainer</strong>
        <div className="nav-links">
          <Link href="/home">Home</Link>
          <Link href="/task">New task</Link>
        </div>
      </nav>
      <section className="container">
        <div className="card">
          <h1 className="title">Progress</h1>
          {error && (
            <p style={{ color: "#c1121f" }}>
              {error} <Link href="/login">Login</Link>
            </p>
          )}
          {!data && <p className="subtitle">Loading progress...</p>}
          {data && (
            <>
              <div className="grid two">
                <div className="metric">
                  <span>Current streak</span>
                  <strong>{data.streak} days</strong>
                </div>
                <div className="metric">
                  <span>Weekly focus</span>
                  <strong>{data.focus ? labelForSkill(data.focus) : "Build more samples"}</strong>
                  <p className="subtitle">
                    Stage: {data.stage || "A0"} | Age: {data.ageBand || "9-11"} | Week {data.cycleWeek || 1}
                  </p>
                </div>
              </div>
              <div className="spacer" />
              <div className="grid two">
                {data.skills.map((skill) => (
                  <div className="metric" key={skill.skillKey}>
                    <span>{labelForSkill(skill.skillKey)}</span>
                    <strong>{skill.current === null ? "n/a" : Math.round(skill.current)}</strong>
                    <p className="subtitle">
                      7d: {deltaLabel(skill.delta7)} | 28d: {deltaLabel(skill.delta28)}
                    </p>
                    <p className="subtitle">
                      Trend: {skill.trend} | Reliability: {skill.reliability} | Samples: {skill.sampleCount}
                    </p>
                  </div>
                ))}
              </div>
              {data.mastery && data.mastery.length > 0 && (
                <>
                  <div className="spacer" />
                  <div className="metric">
                    <span>Mastery snapshot</span>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {data.mastery.map((item) => (
                        <div key={item.skillKey} style={{ minWidth: 130 }}>
                          <strong>{labelForSkill(item.skillKey)}</strong>
                          <div className="subtitle">{Math.round(item.masteryScore)}</div>
                          <div className="subtitle">
                            {item.reliability} | {item.evidenceCount} samples
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
