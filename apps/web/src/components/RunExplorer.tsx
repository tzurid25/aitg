"use client";

import { useMemo, useRef, useState } from "react";
import { MutationStrip, Card, SectionLabel, StatusBadge, CodeLine } from "@aitg/ui";
import { buildFixPrompt, triageSurvivors, survivorsByFile } from "@aitg/shared";
import type { Mutant, MutantStatus, SurvivorGroup } from "@aitg/shared";

interface ExplorerMutant {
  id: string;
  filePath: string;
  lineNumber: number;
  mutatorName: string;
  status: MutantStatus;
  originalCode: string | null;
  mutatedCode: string | null;
}

type Tab = "gaps" | "all" | "prompt";

const SEVERITY_COLOR: Record<SurvivorGroup["severity"], string> = {
  critical: "var(--fail)",
  high: "var(--survived)",
  medium: "var(--timeout)",
  low: "var(--text-faint)",
};

export function RunExplorer({
  mutants,
  score,
  threshold,
}: {
  mutants: ExplorerMutant[];
  score: number;
  threshold: number;
}) {
  const [tab, setTab] = useState<Tab>("gaps");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scopeFile, setScopeFile] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const survivorPayload: Mutant[] = useMemo(
    () =>
      mutants
        .filter((m) => m.status === "SURVIVED")
        .map((m) => ({
          id: m.id,
          filePath: m.filePath,
          lineNumber: m.lineNumber,
          mutatorName: m.mutatorName,
          status: m.status,
          originalCode: m.originalCode ?? undefined,
          mutatedCode: m.mutatedCode ?? undefined,
        })),
    [mutants],
  );

  const triage = useMemo(
    () => triageSurvivors(survivorPayload, { limit: 10, filePath: scopeFile ?? undefined }),
    [survivorPayload, scopeFile],
  );

  const fileBreakdown = useMemo(() => survivorsByFile(survivorPayload), [survivorPayload]);

  const prompt = useMemo(
    () =>
      buildFixPrompt(survivorPayload, {
        score,
        threshold,
        filePath: scopeFile ?? undefined,
        limit: 10,
      }),
    [survivorPayload, score, threshold, scopeFile],
  );

  function onSelect(id: string) {
    const mutant = mutants.find((m) => m.id === id);
    if (!mutant) return;
    if (mutant.status !== "SURVIVED") setTab("all");
    setSelectedId(id);
    requestAnimationFrame(() => {
      rowRefs.current[id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <Card>
          <SectionLabel>Mutation readout · {mutants.length.toLocaleString()} mutants</SectionLabel>
          <MutationStrip
            mutants={mutants.map((m) => ({
              id: m.id,
              status: m.status,
              filePath: m.filePath,
              lineNumber: m.lineNumber,
              mutatorName: m.mutatorName,
            }))}
            onSelect={onSelect}
          />
        </Card>
      </div>

      {/* Scope selector. Fixing one file at a time is how this work actually
          gets done; a prompt spanning five files produces a change set nobody
          wants to review. */}
      {fileBreakdown.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 8 }}>
            Focus on one file
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip active={scopeFile === null} onClick={() => setScopeFile(null)}>
              All files ({survivorPayload.length})
            </Chip>
            {fileBreakdown.slice(0, 6).map((entry) => (
              <Chip
                key={entry.filePath}
                active={scopeFile === entry.filePath}
                onClick={() => setScopeFile(entry.filePath)}
              >
                {entry.filePath.split("/").pop()} ({entry.count})
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        <TabButton active={tab === "gaps"} onClick={() => setTab("gaps")}>
          Testing gaps ({triage.totalGroups})
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All mutants ({mutants.length})
        </TabButton>
        <TabButton active={tab === "prompt"} onClick={() => setTab("prompt")}>
          AI fix prompt
        </TabButton>
      </div>

      {tab === "gaps" && (
        <>
          {triage.groups.length === 0 ? (
            <Card>
              <div style={{ padding: "28px 0", textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  Nothing survived
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Every mutation in the changed code was caught by your tests.
                </div>
              </div>
            </Card>
          ) : (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  marginBottom: 12,
                  lineHeight: 1.6,
                }}
              >
                {triage.totalSurvivors} surviving mutant
                {triage.totalSurvivors === 1 ? "" : "s"} reduce to{" "}
                <strong style={{ color: "var(--text)" }}>
                  {triage.totalGroups} distinct gap{triage.totalGroups === 1 ? "" : "s"}
                </strong>
                . The same mutation repeated across many lines is one missing test
                pattern, not many.
              </div>

              {triage.groups.map((group, index) => (
                <div key={`${group.filePath}-${group.mutatorName}-${index}`} style={{ marginBottom: 10 }}>
                  <Card>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          letterSpacing: "0.08em",
                          padding: "2px 7px",
                          borderRadius: "var(--radius-sm)",
                          color: SEVERITY_COLOR[group.severity],
                          border: `1px solid ${SEVERITY_COLOR[group.severity]}`,
                        }}
                      >
                        {group.severity.toUpperCase()}
                      </span>
                      <span className="mono" style={{ fontSize: 12.5 }}>
                        {group.filePath}
                      </span>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                        {group.occurrences === 1
                          ? `line ${group.lines[0]}`
                          : `${group.occurrences}× — lines ${group.lines.slice(0, 5).join(", ")}${group.lines.length > 5 ? "…" : ""}`}
                      </span>
                    </div>

                    {group.originalCode && (
                      <div style={{ borderRadius: "var(--radius-sm)", overflow: "hidden", marginBottom: 10 }}>
                        <CodeLine variant="original">- {group.originalCode}</CodeLine>
                        {group.mutatedCode && (
                          <CodeLine variant="mutated">+ {group.mutatedCode}</CodeLine>
                        )}
                      </div>
                    )}

                    <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                      {group.rationale}
                    </div>
                  </Card>
                </div>
              ))}

              {triage.omittedGroups > 0 && (
                <div
                  style={{
                    padding: "12px 16px",
                    fontSize: 12.5,
                    color: "var(--text-faint)",
                    border: "1px dashed var(--border-strong)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  {triage.omittedGroups} lower-priority gap
                  {triage.omittedGroups === 1 ? "" : "s"} not shown. Close these first and
                  re-scan — the next batch will be smaller.
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "prompt" && (
        <Card>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <SectionLabel>
              {scopeFile ? `Scoped to ${scopeFile.split("/").pop()}` : "All files"} · top 10 gaps
            </SectionLabel>
            <button
              type="button"
              onClick={() => void copy(prompt, "prompt")}
              style={{
                padding: "6px 12px",
                fontSize: 12.5,
                fontFamily: "inherit",
                background: copied === "prompt" ? "var(--killed-dim)" : "var(--surface-raised)",
                color: copied === "prompt" ? "var(--killed)" : "var(--text)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              {copied === "prompt" ? "Copied" : "Copy prompt"}
            </button>
          </div>

          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-muted)",
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            Paste into Claude, Cursor, or Copilot. Deliberately capped and deduplicated —
            a prompt listing every survivor overflows the model&apos;s context and produces
            a change set too large to review.
          </div>

          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 14,
              fontSize: 12,
              lineHeight: 1.65,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              maxHeight: 480,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {prompt}
          </pre>
        </Card>
      )}

      {tab === "all" && (
        <Card padded={false}>
          <div style={{ maxHeight: 620, overflow: "auto" }}>
            {mutants.map((mutant) => {
              const selected = mutant.id === selectedId;
              return (
                <div
                  key={mutant.id}
                  ref={(el) => {
                    rowRefs.current[mutant.id] = el;
                  }}
                  style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid var(--border)",
                    background: selected ? "var(--surface-raised)" : "transparent",
                    borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: mutant.originalCode ? 10 : 0,
                      flexWrap: "wrap",
                    }}
                  >
                    <StatusBadge status={mutant.status} />
                    <span className="mono" style={{ fontSize: 12.5 }}>
                      {mutant.filePath}
                      <span style={{ color: "var(--text-faint)" }}>:{mutant.lineNumber}</span>
                    </span>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                      {mutant.mutatorName}
                    </span>
                  </div>

                  {mutant.originalCode && (
                    <div style={{ borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                      <CodeLine variant="original">- {mutant.originalCode}</CodeLine>
                      {mutant.mutatedCode && (
                        <CodeLine variant="mutated">+ {mutant.mutatedCode}</CodeLine>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 13px",
        fontSize: 13,
        fontFamily: "inherit",
        fontWeight: active ? 500 : 400,
        background: active ? "var(--surface-raised)" : "transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
        border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mono"
      style={{
        padding: "5px 10px",
        fontSize: 11.5,
        fontFamily: "var(--font-mono)",
        background: active ? "var(--accent)" : "var(--surface-raised)",
        color: active ? "#06251F" : "var(--text-muted)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-full, 9999px)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
