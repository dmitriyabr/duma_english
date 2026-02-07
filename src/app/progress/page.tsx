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
  placementConfidence?: number | null;
  placementFresh?: boolean;
  carryoverSummary?: {
    carryoverApplied?: boolean;
    carryoverNodes?: string[];
  } | null;
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
  nodeProgress?: {
    masteredNodes: number;
    inProgressNodes: number;
    delta7: number;
    delta28: number;
    coverage7: number;
    coverage28: number;
    nextTargetNodes: Array<{
      nodeId: string;
      descriptor: string;
      skill?: string | null;
      gseCenter?: number | null;
      masteryScore: number;
      reliability: "high" | "medium" | "low";
    }>;
  };
  nodeCoverageByBand?: Record<string, { mastered: number; total: number }>;
  overdueNodes?: Array<{
    nodeId: string;
    descriptor: string;
    daysSinceEvidence: number;
    halfLifeDays: number;
    decayedMastery: number;
  }>;
  uncertainNodes?: Array<{
    nodeId: string;
    descriptor: string;
    sigma: number;
    mastery: number;
  }>;
  promotionReadiness?: {
    currentStage: string;
    targetStage: string;
    ready: boolean;
    readinessScore: number;
    coverageRatio: number;
    blockedByNodes: string[];
    blockedByNodeDescriptors?: string[];
  };
  weeklyFocusReason?: string;
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
    case "grammar":
      return "Grammar";
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
                  {data.weeklyFocusReason && <p className="subtitle">{data.weeklyFocusReason}</p>}
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
              {data.nodeProgress && (
                <>
                  <div className="spacer" />
                  <div className="metric">
                    <span>GSE node progress</span>
                    <p className="subtitle">
                      Mastered: {data.nodeProgress.masteredNodes} | In progress: {data.nodeProgress.inProgressNodes}
                    </p>
                    <p className="subtitle">
                      Node coverage 7d: {data.nodeProgress.coverage7} ({data.nodeProgress.delta7 >= 0 ? "+" : ""}
                      {data.nodeProgress.delta7}) | 28d: {data.nodeProgress.coverage28} (
                      {data.nodeProgress.delta28 >= 0 ? "+" : ""}
                      {data.nodeProgress.delta28})
                    </p>
                    {data.nodeProgress.nextTargetNodes.length > 0 && (
                      <ul style={{ paddingLeft: 16 }}>
                        {data.nodeProgress.nextTargetNodes.map((node) => (
                          <li key={node.nodeId}>
                            {node.descriptor} - mastery {Math.round(node.masteryScore)}
                            {typeof node.gseCenter === "number" ? `, GSE ${Math.round(node.gseCenter)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
              {data.promotionReadiness && (
                <>
                  <div className="spacer" />
                  <div className="metric">
                    <span>Promotion readiness</span>
                    <p className="subtitle">
                      {data.promotionReadiness.currentStage} → {data.promotionReadiness.targetStage} | Score:{" "}
                      {data.promotionReadiness.readinessScore} | Coverage: {data.promotionReadiness.coverageRatio}%
                    </p>
                    <p className="subtitle">
                      Status: {data.promotionReadiness.ready ? "Ready" : "Blocked"}
                    </p>
                    {!data.promotionReadiness.ready &&
                      (data.promotionReadiness.blockedByNodeDescriptors?.length || 0) > 0 && (
                        <p className="subtitle">
                          Blockers: {data.promotionReadiness.blockedByNodeDescriptors?.slice(0, 5).join(", ")}
                        </p>
                      )}
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
