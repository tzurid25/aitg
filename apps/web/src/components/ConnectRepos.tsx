"use client";

import { useEffect, useState } from "react";
import { Card, SectionLabel, EmptyState } from "@aitg/ui";

interface Repo {
  fullName: string;
  installationId: string;
  private: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "working"; repo: string }
  | { kind: "done"; repo: string; url: string; alreadyPresent?: boolean }
  | { kind: "error"; repo: string; message: string; hint?: string };

export function ConnectRepos({ hasInstallation }: { hasInstallation: boolean }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [connected, setConnected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!hasInstallation) return;
    void (async () => {
      try {
        const response = await fetch("/api/github/repos");
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { repositories: Repo[] };
        setRepos(data.repositories);
      } catch {
        setLoadError("Could not load repositories from GitHub.");
      }
    })();
  }, [hasInstallation]);

  async function connect(repo: Repo) {
    setStatus({ kind: "working", repo: repo.fullName });
    try {
      const response = await fetch("/api/github/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: repo.fullName,
          installationId: repo.installationId,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setStatus({
          kind: "error",
          repo: repo.fullName,
          message: data.message ?? "Setup failed.",
          hint: data.hint,
        });
        return;
      }

      setConnected((prev) => new Set(prev).add(repo.fullName));
      setStatus({
        kind: "done",
        repo: repo.fullName,
        url: data.pullRequestUrl,
        alreadyPresent: data.alreadyPresent,
      });
    } catch {
      setStatus({
        kind: "error",
        repo: repo.fullName,
        message: "Could not reach the server.",
        hint: "Check your connection and try again.",
      });
    }
  }

  if (!hasInstallation) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <Card>
        <SectionLabel>Connect a repository</SectionLabel>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.7 }}>
          One click sets the API key in the repository&apos;s Actions secrets and opens a
          pull request adding the workflow. Review the diff and merge — nothing reaches
          your default branch without your approval.
        </p>

        {loadError && (
          <div style={{ fontSize: 13, color: "var(--fail)" }}>{loadError}</div>
        )}

        {!repos && !loadError && (
          <div style={{ fontSize: 13, color: "var(--text-faint)" }}>Loading repositories…</div>
        )}

        {repos && repos.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            The installation has no repositories yet. Grant access to one in GitHub, then
            reload this page.
          </div>
        )}

        {repos && repos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {repos.map((repo) => {
              const isWorking = status.kind === "working" && status.repo === repo.fullName;
              const isConnected = connected.has(repo.fullName);

              return (
                <div
                  key={repo.fullName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <span className="mono" style={{ fontSize: 13 }}>
                    {repo.fullName}
                    {repo.private && (
                      <span style={{ color: "var(--text-faint)", marginLeft: 8, fontSize: 11 }}>
                        private
                      </span>
                    )}
                  </span>

                  <button
                    type="button"
                    onClick={() => void connect(repo)}
                    disabled={isWorking || isConnected}
                    style={{
                      padding: "6px 14px",
                      fontSize: 12.5,
                      fontWeight: 500,
                      fontFamily: "inherit",
                      background: isConnected ? "var(--killed-dim)" : "var(--accent)",
                      color: isConnected ? "var(--killed)" : "#06251F",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      cursor: isWorking || isConnected ? "default" : "pointer",
                      opacity: isWorking ? 0.6 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isConnected ? "Connected" : isWorking ? "Setting up…" : "Connect"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {status.kind === "done" && (
          <div
            style={{
              marginTop: 14,
              padding: "12px 14px",
              background: "var(--killed-dim)",
              border: "1px solid var(--killed)",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong>{status.repo}</strong>{" "}
            {status.alreadyPresent ? (
              <>
                already has the workflow. The API key secret has been set, so it will run
                on the next pull request.
              </>
            ) : (
              <>
                is ready. Secret set, pull request opened.{" "}
                <a
                  href={status.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "underline" }}
                >
                  Review and merge →
                </a>
              </>
            )}
          </div>
        )}

        {status.kind === "error" && (
          <div
            style={{
              marginTop: 14,
              padding: "12px 14px",
              background: "var(--runtime-error-dim)",
              border: "1px solid var(--fail)",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <div style={{ color: "var(--fail)" }}>
              {status.repo}: {status.message}
            </div>
            {status.hint && (
              <div style={{ color: "var(--text-muted)", marginTop: 4 }}>{status.hint}</div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
