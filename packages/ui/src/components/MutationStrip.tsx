"use client";

import { useMemo, useState } from "react";
import type { MutantStatus } from "@aitg/shared";

export interface StripMutant {
  id: string;
  status: MutantStatus;
  filePath: string;
  lineNumber: number;
  mutatorName: string;
}

interface MutationStripProps {
  mutants: StripMutant[];
  onSelect?: (mutantId: string) => void;
  /** Caps rendered cells; beyond this the strip aggregates. */
  maxCells?: number;
}

const STATUS_VAR: Record<MutantStatus, string> = {
  KILLED: "var(--killed)",
  SURVIVED: "var(--survived)",
  TIMEOUT: "var(--timeout)",
  NO_COVERAGE: "var(--no-coverage)",
  RUNTIME_ERROR: "var(--runtime-error)",
  IGNORED: "var(--text-faint)",
};

/**
 * Renders every mutant in a run as one cell in a dense grid — a readout,
 * not a chart.
 *
 * The reason this exists instead of a donut chart: "8 survived out of 340"
 * is a number you read, whereas eight amber cells in a field of teal is
 * something you *see* before you've read anything. Survivors are the entire
 * point of the product, so they get the loudest treatment in the quietest
 * possible surrounding.
 *
 * Killed cells are deliberately dimmed to ~45% — they're the expected case
 * and shouldn't compete. Survivors sit at full opacity with a soft glow.
 */
export function MutationStrip({ mutants, onSelect, maxCells = 2000 }: MutationStripProps) {
  const [hovered, setHovered] = useState<StripMutant | null>(null);

  // Survivors first in the truncation order: if a run is too large to render
  // cell-for-cell, the survivors must still all be visible. Dropping the
  // thing the user is looking for would defeat the visualization.
  const ordered = useMemo(() => {
    const priority: Record<MutantStatus, number> = {
      SURVIVED: 0,
      NO_COVERAGE: 1,
      TIMEOUT: 2,
      RUNTIME_ERROR: 3,
      KILLED: 4,
      IGNORED: 5,
    };
    return [...mutants].sort((a, b) => priority[a.status] - priority[b.status]);
  }, [mutants]);

  const visible = ordered.slice(0, maxCells);
  const truncated = ordered.length - visible.length;

  if (mutants.length === 0) {
    return (
      <div
        style={{
          padding: "24px",
          textAlign: "center",
          color: "var(--text-faint)",
          fontSize: 13,
        }}
      >
        No mutants in this run.
      </div>
    );
  }

  return (
    <div>
      <div
        role="img"
        aria-label={`Mutation readout: ${mutants.length} mutants, ${
          mutants.filter((m) => m.status === "SURVIVED").length
        } survived`}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(9px, 1fr))",
          gap: "2px",
          padding: "14px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
        }}
      >
        {visible.map((mutant) => {
          const isSurvivor = mutant.status === "SURVIVED";
          return (
            <button
              key={mutant.id}
              type="button"
              onMouseEnter={() => setHovered(mutant)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(mutant)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect?.(mutant.id)}
              aria-label={`${mutant.status} at ${mutant.filePath} line ${mutant.lineNumber}`}
              style={{
                aspectRatio: "1",
                minWidth: 0,
                padding: 0,
                border: "none",
                cursor: onSelect ? "pointer" : "default",
                borderRadius: "1px",
                background: STATUS_VAR[mutant.status],
                opacity: mutant.status === "KILLED" ? 0.45 : 1,
                boxShadow: isSurvivor ? "0 0 6px var(--survived)" : "none",
                transition: "transform 120ms ease, opacity 120ms ease",
                transform: hovered?.id === mutant.id ? "scale(1.6)" : "none",
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 8,
          minHeight: 20,
        }}
      >
        <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {hovered ? (
            <>
              <span style={{ color: STATUS_VAR[hovered.status] }}>{hovered.status}</span>
              {"  "}
              {hovered.filePath}:{hovered.lineNumber}{" "}
              <span style={{ color: "var(--text-faint)" }}>({hovered.mutatorName})</span>
            </>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>
              Hover a cell for detail{onSelect ? " · click to open" : ""}
            </span>
          )}
        </div>
        {truncated > 0 && (
          <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
            +{truncated.toLocaleString()} more
          </span>
        )}
      </div>
    </div>
  );
}
