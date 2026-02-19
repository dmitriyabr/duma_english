"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type TaskResponse = {
  taskId: string;
  type: string;
  prompt: string;
  assessmentMode: "pa" | "stt" | "text";
  maxDurationSec: number;
  constraints: { minSeconds: number; maxSeconds: number };
};

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function WritePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const isRevision = searchParams.get("revise") === "1";

  useEffect(() => {
    const stored = localStorage.getItem("currentTask");
    if (stored) {
      const parsed = JSON.parse(stored) as TaskResponse;
      setTask(parsed);
    }
    const previousDraft = localStorage.getItem("lastWritingDraft");
    if (isRevision && previousDraft && previousDraft.trim().length > 0) {
      setDraft(previousDraft);
    }
    startedAtRef.current = Date.now();
  }, [isRevision]);

  const words = useMemo(() => countWords(draft), [draft]);
  const minWords = 25;
  const maxWordsSoft = 180;
  const disabled = status === "submitting";

  async function submitText() {
    setError(null);
    if (!task) {
      setError("Task is missing. Go back to Task page and load a quest.");
      return;
    }
    if (task.assessmentMode !== "text") {
      setError("This task expects voice input. Please use Record mode.");
      return;
    }
    if (words < minWords) {
      setError(`Please write at least ${minWords} words before submitting.`);
      return;
    }

    try {
      setStatus("submitting");
      const elapsedMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      const durationSec = Math.max(5, Math.min(900, Math.round(elapsedMs / 1000)));
      const response = await fetch("/api/attempts/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.taskId,
          text: draft.trim(),
          durationSec,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to submit text attempt");
      }
      const payload = (await response.json()) as { attemptId: string };
      localStorage.setItem("lastAttemptId", payload.attemptId);
      localStorage.setItem("lastWritingDraft", draft.trim());
      router.push(`/results?attemptId=${payload.attemptId}`);
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Failed to submit attempt");
    }
  }

  if (!task) {
    return (
      <div className="page task-page">
        <section className="task-hero">
          <div className="task-mobile-frame">
            <p className="task-kicker">✍️ WRITING QUEST</p>
            <h1 className="task-title-main">No task loaded yet</h1>
            <p className="subtitle">
              Open <Link href="/task">Task</Link> first.
            </p>
          </div>
        </section>
      </div>
    );
  }

  if (task.assessmentMode !== "text") {
    return (
      <div className="page task-page">
        <section className="task-hero">
          <div className="task-mobile-frame">
            <p className="task-kicker">✍️ WRITING QUEST</p>
            <h1 className="task-title-main">This is a voice task</h1>
            <p className="subtitle">
              Continue in <Link href="/record">Record mode</Link>.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page task-page">
      <section className="task-hero">
        <div className="task-mobile-frame">
          <div className="task-top-row">
            <div className="task-nav-mini">
              <Link href="/task">Task</Link>
              <Link href="/home">Home</Link>
            </div>
          </div>

          <p className="task-kicker">✍️ WRITING QUEST</p>
          <h1 className="task-title-main">Write your answer</h1>
          <h2 className="task-title-accent">{isRevision ? "Revise and improve it" : "First draft time"}</h2>

          <article className="task-mission-card" style={{ marginBottom: 16 }}>
            <div className="task-mission-top">
              <div className="task-icon-circle" aria-hidden>
                📝
              </div>
              <div className="task-mission-copy">
                <p className="task-mission-label">YOUR WRITING MISSION:</p>
                <p className="task-prompt-text">{task.prompt}</p>
              </div>
            </div>
          </article>

          <div style={{ display: "grid", gap: 12 }}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write your answer here..."
              rows={9}
              maxLength={2200}
              disabled={disabled}
            />
            <p className="subtitle">
              Words: {words} (target {minWords}-{maxWordsSoft})
            </p>
            {error && <p className="task-error">{error}</p>}
          </div>

          <div className="task-start-wrap" style={{ marginTop: 16 }}>
            <button className="btn task-start-btn" onClick={submitText} disabled={disabled}>
              <span className="task-cta-icon">📨</span>
              {disabled ? "Submitting..." : "Submit my writing"}
            </button>
            <p className="task-start-sub">You can rewrite after feedback.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function WritePage() {
  return (
    <Suspense
      fallback={
        <div className="page task-page">
          <section className="task-hero">
            <div className="task-mobile-frame">
              <p className="task-kicker">✍️ WRITING QUEST</p>
              <h1 className="task-title-main">Loading writing task...</h1>
            </div>
          </section>
        </div>
      }
    >
      <WritePageContent />
    </Suspense>
  );
}
