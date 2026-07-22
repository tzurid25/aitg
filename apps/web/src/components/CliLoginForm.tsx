"use client";

import { useState } from "react";
import { Card } from "@aitg/ui";

type Phase = "input" | "approved" | "denied";

export function CliLoginForm({ organizationName }: { organizationName: string }) {
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  /** Formats as the user types: ABCDEFGH -> ABCD-EFGH. */
  function onChange(value: string) {
    const cleaned = value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
    setCode(cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned);
    setError(null);
  }

  async function submit(action: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cli-auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: code }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError({ message: data.message ?? "Something went wrong.", hint: data.hint });
        return;
      }

      setPhase(action === "approve" ? "approved" : "denied");
    } catch {
      setError({
        message: "Couldn't reach the server.",
        hint: "Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (phase === "approved") {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            Device authorized
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.6 }}>
            Your terminal is now signed in to{" "}
            <span style={{ color: "var(--text)" }}>{organizationName}</span>.
            <br />
            You can close this tab and return to your terminal.
          </div>
        </div>
      </Card>
    );
  }

  if (phase === "denied") {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Request rejected</div>
          <div style={{ color: "var(--text-muted)", fontSize: 13.5 }}>
            That device was not authorized. Nothing was granted access.
          </div>
        </div>
      </Card>
    );
  }

  const complete = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code);

  return (
    <Card>
      <label
        htmlFor="device-code"
        className="label"
        style={{ display: "block", marginBottom: 10 }}
      >
        Device code
      </label>

      <input
        id="device-code"
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && complete && !busy) void submit("approve");
        }}
        placeholder="ABCD-EFGH"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        aria-describedby={error ? "device-code-error" : undefined}
        className="mono"
        style={{
          width: "100%",
          padding: "14px 16px",
          fontSize: 24,
          letterSpacing: "0.18em",
          textAlign: "center",
          background: "var(--bg)",
          border: `1px solid ${error ? "var(--fail)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius-md)",
          color: "var(--text)",
          outline: "none",
        }}
      />

      {error && (
        <div id="device-code-error" role="alert" style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ color: "var(--fail)" }}>{error.message}</div>
          {error.hint && (
            <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{error.hint}</div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button
          type="button"
          onClick={() => void submit("approve")}
          disabled={!complete || busy}
          style={{
            flex: 1,
            padding: "11px 16px",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "inherit",
            background: complete ? "var(--accent)" : "var(--surface-raised)",
            color: complete ? "#06251F" : "var(--text-faint)",
            border: "none",
            borderRadius: "var(--radius-md)",
            cursor: complete && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Authorizing…" : "Authorize device"}
        </button>
        <button
          type="button"
          onClick={() => void submit("deny")}
          disabled={!complete || busy}
          style={{
            padding: "11px 16px",
            fontSize: 14,
            fontFamily: "inherit",
            background: "transparent",
            color: "var(--text-muted)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            cursor: complete && !busy ? "pointer" : "not-allowed",
          }}
        >
          Reject
        </button>
      </div>

      <div
        style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid var(--border)",
          fontSize: 12.5,
          color: "var(--text-faint)",
          lineHeight: 1.6,
        }}
      >
        Only authorize a code you started yourself by running{" "}
        <span className="mono" style={{ color: "var(--text-muted)" }}>
          aitg login
        </span>
        . Approving grants that machine scan access to {organizationName}.
      </div>
    </Card>
  );
}
