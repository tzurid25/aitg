"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

/**
 * GitHub is the primary path, not one option among equals. This audience
 * already has a GitHub account, already trusts the OAuth flow, and every
 * field we ask them to fill is a place they can leave. Email/password sits
 * below a divider as the fallback it is.
 */
export function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/app";
  const oauthError = params.get("error");

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    oauthError ? "That sign-in didn't complete. Try again." : null,
  );
  const [busy, setBusy] = useState(false);

  async function credentialsSignIn() {
    setBusy(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setBusy(false);

    if (result?.error) {
      setError("Email or password is incorrect.");
      return;
    }
    window.location.href = callbackUrl;
  }

  const oauthButton = (provider: string, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => void signIn(provider, { callbackUrl })}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "12px 16px",
        fontSize: 14,
        fontWeight: 500,
        fontFamily: "inherit",
        background: "var(--surface-raised)",
        color: "var(--text)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        marginBottom: 10,
      }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>
        {icon}
      </span>
      {label}
    </button>
  );

  return (
    <div>
      {oauthButton("github", "Continue with GitHub", "◉")}
      {oauthButton("google", "Continue with Google", "○")}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "18px 0",
          color: "var(--text-faint)",
          fontSize: 12,
        }}
      >
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        or
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {!showPassword ? (
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          style={{
            width: "100%",
            padding: "10px",
            fontSize: 13.5,
            fontFamily: "inherit",
            background: "transparent",
            color: "var(--text-muted)",
            border: "none",
            cursor: "pointer",
          }}
        >
          Use email and password
        </button>
      ) : (
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void credentialsSignIn();
            }}
            placeholder="Password"
            autoComplete="current-password"
            style={{ ...inputStyle, marginTop: 8 }}
          />
          <button
            type="button"
            onClick={() => void credentialsSignIn()}
            disabled={busy || !email || !password}
            style={{
              width: "100%",
              marginTop: 12,
              padding: "11px 16px",
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "inherit",
              background: "var(--accent)",
              color: "#06251F",
              border: "none",
              borderRadius: "var(--radius-md)",
              cursor: busy ? "wait" : "pointer",
              opacity: !email || !password ? 0.5 : 1,
            }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 12, fontSize: 13, color: "var(--fail)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  fontSize: 14,
  fontFamily: "inherit",
  background: "var(--bg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  color: "var(--text)",
  outline: "none",
};
