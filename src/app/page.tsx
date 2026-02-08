import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="page">
      <nav className="nav">
        <strong style={{ fontFamily: "var(--font-display)" }}>Duma Trainer</strong>
        <div className="nav-links">
          <Link href="/login">Student login</Link>
          <Link href="/teacher">Teacher</Link>
          <Link href="/progress">Progress</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="container">
          <span className="pill">AI Speaking Trainer</span>
          <div className="spacer" />
          <h1 className="title">Speak boldly. Grow fast.</h1>
          <p className="subtitle">
            Short, repeatable speaking sessions for Kenyan students. Record, get
            instant feedback, and build confidence day by day.
          </p>
          <div className="spacer" />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="btn" href="/login">
              Start practice
            </Link>
            <Link className="btn ghost" href="/teacher">
              Teacher
            </Link>
          </div>

          <div className="spacer" />
          <div className="grid three">
            {[
              {
                title: "1 task at a time",
                text: "Clear instructions and a single recording.",
              },
              {
                title: "Actionable feedback",
                text: "Two strengths, two fixes, one next step.",
              },
              {
                title: "Public speaking focus",
                text: "Structure, delivery, and confidence grow each week.",
              },
            ].map((item) => (
              <div key={item.title} className="card">
                <h3 style={{ fontFamily: "var(--font-display)" }}>{item.title}</h3>
                <p className="subtitle">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 40 }}>
        <div className="card">
          <div className="grid two">
            <div>
              <h2 style={{ fontFamily: "var(--font-display)" }}>
                Daily practice in minutes
              </h2>
              <p className="subtitle">
                Each session is short and friendly. Students repeat until the score
                improves.
              </p>
              <div className="spacer" />
              <Link className="btn secondary" href="/login">
                Try a session
              </Link>
            </div>
            <div className="metric">
              <span className="status">
                <span className="status-dot" />
                AI feedback ready in seconds
              </span>
              <strong>Focus areas</strong>
              <p className="subtitle">
                Pronunciation, fluency, pace, and structure. The system adapts as
                learners improve.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        Built for low-friction speaking practice. Powered by Azure Speech and OpenAI.
      </footer>
    </div>
  );
}
