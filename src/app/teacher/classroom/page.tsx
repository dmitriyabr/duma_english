"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ClassItem = {
  id: string;
  name: string;
};

type ClassroomStudent = {
  id: string;
  displayName: string;
  loginCode: string | null;
  lastLessonStatus: string;
  continueAvailable: boolean;
  lastLessonId: string | null;
  lastLessonUpdatedAt: string | null;
};

type ClassroomResponse = {
  classId: string;
  className: string;
  students: ClassroomStudent[];
};

type LiveBoardRow = {
  studentId: string;
  status: "in_progress" | "stuck" | "retry_loop" | "completed";
  stepType: string | null;
  stepOrdinal: number | null;
  stepEtaMin: number | null;
  blockerLabel: string | null;
};

type LiveBoardResponse = {
  rows: LiveBoardRow[];
};

function statusLabel(status: LiveBoardRow["status"] | string) {
  if (status === "in_progress") return "In progress";
  if (status === "stuck") return "Stuck";
  if (status === "retry_loop") return "Retry loop";
  if (status === "completed") return "Completed";
  return "No lesson";
}

export default function TeacherClassroomPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classroom, setClassroom] = useState<ClassroomResponse | null>(null);
  const [liveBoard, setLiveBoard] = useState<LiveBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/teacher/classes")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((payload: { classes: Array<{ id: string; name: string }> }) => {
        const classItems = payload.classes.map((item) => ({ id: item.id, name: item.name }));
        setClasses(classItems);
        if (classItems.length > 0) {
          setSelectedClassId((current) => current || classItems[0].id);
        }
      })
      .catch(() => {
        setError("Unable to load classes");
      });
  }, []);

  useEffect(() => {
    if (!selectedClassId) return;

    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [classroomRes, liveRes] = await Promise.all([
          fetch(`/api/teacher/classroom?classId=${encodeURIComponent(selectedClassId)}`),
          fetch(`/api/teacher/live-board?classId=${encodeURIComponent(selectedClassId)}`),
        ]);

        if (!classroomRes.ok || !liveRes.ok) throw new Error("Unable to load classroom");

        const [classroomPayload, livePayload] = (await Promise.all([
          classroomRes.json(),
          liveRes.json(),
        ])) as [ClassroomResponse, LiveBoardResponse];

        if (!cancelled) {
          setClassroom(classroomPayload);
          setLiveBoard(livePayload);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load classroom view");
        }
      }
    };

    void fetchAll();
    const poll = window.setInterval(() => {
      void fetchAll();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [selectedClassId]);

  const liveByStudent = useMemo(() => {
    const map = new Map<string, LiveBoardRow>();
    for (const row of liveBoard?.rows || []) {
      map.set(row.studentId, row);
    }
    return map;
  }, [liveBoard]);

  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Teacher classroom</strong>
        <div className="nav-links">
          <Link href="/teacher">Classes</Link>
          <Link href="/teacher/login">Switch account</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="container">
          <h1 className="title">Classroom mode</h1>
          <p className="subtitle">One screen: start/continue status for all students.</p>

          <div className="spacer" />

          {classes.length > 0 && (
            <div className="field" style={{ maxWidth: 340 }}>
              <label>Class</label>
              <select
                value={selectedClassId || ""}
                onChange={(event) => setSelectedClassId(event.target.value)}
              >
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="spacer" />
          {error && <p style={{ color: "var(--accent-1)" }}>{error}</p>}

          {!classroom ? (
            <div className="card">
              <p className="subtitle">Loading classroom...</p>
            </div>
          ) : (
            <div className="card">
              <h2 style={{ fontFamily: "var(--font-display)", marginBottom: 12 }}>{classroom.className}</h2>
              {!classroom.students.length ? (
                <p className="subtitle">No students in this class.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(16,22,47,0.12)" }}>
                        <th style={{ padding: "10px" }}>Student</th>
                        <th style={{ padding: "10px" }}>Status</th>
                        <th style={{ padding: "10px" }}>Step</th>
                        <th style={{ padding: "10px" }}>ETA</th>
                        <th style={{ padding: "10px" }}>Blocker</th>
                        <th style={{ padding: "10px" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classroom.students.map((student) => {
                        const live = liveByStudent.get(student.id);
                        return (
                          <tr key={student.id} style={{ borderBottom: "1px solid rgba(16,22,47,0.06)" }}>
                            <td style={{ padding: "10px" }}>{student.displayName}</td>
                            <td style={{ padding: "10px" }}>{statusLabel(live?.status || student.lastLessonStatus)}</td>
                            <td style={{ padding: "10px" }}>{live?.stepType || "-"}</td>
                            <td style={{ padding: "10px" }}>{typeof live?.stepEtaMin === "number" ? `${live.stepEtaMin}m` : "-"}</td>
                            <td style={{ padding: "10px" }}>{live?.blockerLabel || "-"}</td>
                            <td style={{ padding: "10px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Link
                                className="btn ghost"
                                style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                                href={`/teacher/students/${student.id}`}
                              >
                                {student.continueAvailable ? "Continue" : "Start"}
                              </Link>
                              <Link
                                className="btn ghost"
                                style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                                href={`/teacher/students/${student.id}`}
                              >
                                Profile
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
