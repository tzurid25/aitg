import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionContext } from "../../lib/session";
import { LoginForm } from "../../components/LoginForm";
import { Card } from "@aitg/ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — AI Test Integrity Guard" };

export default async function LoginPage() {
  const session = await getSessionContext();
  if (session) redirect("/app");

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
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ marginBottom: 26, textAlign: "center" }}>
          <div className="label" style={{ marginBottom: 10 }}>
            AI Test Integrity Guard
          </div>
          <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            Sign in
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginTop: 6 }}>
            Coverage is not quality. Mutation score is.
          </p>
        </div>

        <Card>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </Card>

        <p
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 12.5,
            color: "var(--text-faint)",
          }}
        >
          No credit card required. Free tier includes 3 projects.
        </p>
      </div>
    </main>
  );
}
