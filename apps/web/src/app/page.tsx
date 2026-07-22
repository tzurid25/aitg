import Link from "next/link";

export const metadata = {
  title: "AI Test Integrity Guard — coverage is not quality",
  description:
    "AI writes tests that pass. AITG proves whether they'd catch a bug. Mutation-tested quality gates on every pull request.",
};

/**
 * The hero states the problem as a number, not a slogan. This audience is
 * skeptical of marketing language and responds to a measurable claim they
 * can check against their own repo.
 */
export default function LandingPage() {
  return (
    <main>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "18px 32px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span className="mono" style={{ fontWeight: 600 }}>
          aitg
        </span>
        <Link href="/login" style={{ fontSize: 13.5, color: "var(--text-muted)" }}>
          Sign in
        </Link>
      </header>

      <section style={{ maxWidth: 780, margin: "0 auto", padding: "88px 32px 64px" }}>
        <div className="label" style={{ marginBottom: 18 }}>
          Mutation testing for AI-generated code
        </div>

        <h1
          style={{
            fontSize: 42,
            lineHeight: 1.15,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            margin: "0 0 20px",
          }}
        >
          Your tests pass.
          <br />
          <span style={{ color: "var(--survived)" }}>That proves nothing.</span>
        </h1>

        <p
          style={{
            fontSize: 17,
            lineHeight: 1.65,
            color: "var(--text-muted)",
            margin: "0 0 32px",
            maxWidth: 620,
          }}
        >
          AI coding agents produce high line coverage with assertions that can&apos;t fail —
          circular mocks, hard-coded expectations, tests that execute code without verifying it.
          AITG changes your code on purpose and checks whether your suite notices.
        </p>

        <pre
          className="mono"
          style={{
            padding: 18,
            fontSize: 13,
            lineHeight: 1.9,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            overflow: "auto",
            margin: "0 0 32px",
          }}
        >{`$ aitg scan

  Diff against origin/main (a3f91c2..8e21d40)
  4 files · 61 changed lines

  Mutation score: `}
          <span style={{ color: "var(--fail)" }}>38.0%</span>
          {`
  Killed 19 · `}
          <span style={{ color: "var(--survived)" }}>Survived 31</span>
          {` · No coverage 12

  ! src/pricing.ts:44   ConditionalExpression
  ! src/pricing.ts:52   EqualityOperator
  ! src/invoice.ts:118  BooleanLiteral

  Quality gate failed. Line coverage was 87%.`}
        </pre>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/login"
            style={{
              padding: "12px 22px",
              fontSize: 14,
              fontWeight: 500,
              background: "var(--accent)",
              color: "#06251F",
              borderRadius: "var(--radius-md)",
            }}
          >
            Start free
          </Link>
          <span style={{ alignSelf: "center", fontSize: 13, color: "var(--text-faint)" }}>
            No credit card. Runs on your machine — your source never leaves it.
          </span>
        </div>
      </section>

      <section
        style={{
          maxWidth: 780,
          margin: "0 auto",
          padding: "0 32px 88px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 28,
        }}
      >
        {[
          {
            title: "Scoped to your diff",
            body: "Only the lines you changed are mutated, so a scan takes minutes instead of hours.",
          },
          {
            title: "Blocks the PR",
            body: "Exits non-zero below your threshold. Drops into CI as one step, no wiring.",
          },
          {
            title: "Hands you the fix",
            body: "Generates a prompt for each surviving mutant, constrained so the AI strengthens the test instead of weakening the code.",
          },
        ].map((item) => (
          <div key={item.title}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>{item.title}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
              {item.body}
            </div>
          </div>
        ))}
      </section>

      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "22px 32px",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12.5,
          color: "var(--text-faint)",
        }}
      >
        <span>AI Test Integrity Guard</span>
        <a href="https://tacticode.co.il" target="_blank" rel="noreferrer">
          Designed &amp; Powered by TactiCode
        </a>
      </footer>
    </main>
  );
}
