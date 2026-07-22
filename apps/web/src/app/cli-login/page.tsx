import { requireSession } from "../../lib/session";
import { CliLoginForm } from "../../components/CliLoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Authorize device — AI Test Integrity Guard" };

export default async function CliLoginPage() {
  // requireSession redirects to /login, and NextAuth returns here after
  // sign-in, so the code the user is holding survives the round trip.
  const session = await requireSession();

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ marginBottom: 24 }}>
          <div className="label" style={{ marginBottom: 8 }}>
            AI Test Integrity Guard
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            Authorize your terminal
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginTop: 6 }}>
            Enter the code shown in your terminal to finish signing in.
          </p>
        </div>

        <CliLoginForm organizationName={session.organizationName} />
      </div>
    </main>
  );
}
