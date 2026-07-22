import type { CSSProperties, ReactNode } from "react";
import type { MutantStatus } from "@aitg/shared";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  children,
  padded = true,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: padded ? 20 : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="label" style={{ marginBottom: 12 }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<MutantStatus, { fg: string; bg: string; text: string }> = {
  KILLED: { fg: "var(--killed)", bg: "var(--killed-dim)", text: "Killed" },
  SURVIVED: { fg: "var(--survived)", bg: "var(--survived-dim)", text: "Survived" },
  TIMEOUT: { fg: "var(--timeout)", bg: "var(--timeout-dim)", text: "Timed out" },
  NO_COVERAGE: { fg: "var(--no-coverage)", bg: "var(--no-coverage-dim)", text: "No coverage" },
  RUNTIME_ERROR: {
    fg: "var(--runtime-error)",
    bg: "var(--runtime-error-dim)",
    text: "Runtime error",
  },
  IGNORED: { fg: "var(--text-faint)", bg: "var(--surface-raised)", text: "Ignored" },
};

export function StatusBadge({ status }: { status: MutantStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        padding: "2px 7px",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.04em",
        color: s.fg,
        background: s.bg,
        borderRadius: "var(--radius-sm)",
        whiteSpace: "nowrap",
      }}
    >
      {s.text}
    </span>
  );
}

export function GateBadge({ status }: { status: "PASSED" | "FAILED" | "WARNING" }) {
  const map = {
    PASSED: { fg: "var(--pass)", bg: "var(--killed-dim)", text: "Passed" },
    WARNING: { fg: "var(--warn)", bg: "var(--survived-dim)", text: "Warning" },
    FAILED: { fg: "var(--fail)", bg: "var(--runtime-error-dim)", text: "Failed" },
  }[status];

  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: map.fg,
        background: map.bg,
        borderRadius: "var(--radius-full, 9999px)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: map.fg,
        }}
      />
      {map.text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ScoreDial — the headline number
// ---------------------------------------------------------------------------

/**
 * Deliberately not a donut chart. The arc is a threshold gauge: the notch
 * marks where the quality gate sits, so "are we above the line" is legible
 * without reading either number. The score itself is the loudest type on
 * the page because it's the one thing a lead actually acts on.
 */
export function ScoreDial({
  score,
  threshold,
  size = 132,
}: {
  score: number;
  threshold: number;
  size?: number;
}) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = Math.PI * radius; // semicircle
  const clamped = Math.max(0, Math.min(100, score));
  const passing = score >= threshold;
  const color = passing ? "var(--pass)" : "var(--fail)";

  const thresholdAngle = 180 - (threshold / 100) * 180;
  const thresholdRad = (thresholdAngle * Math.PI) / 180;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div style={{ position: "relative", width: size, height: size / 2 + 24 }}>
      <svg width={size} height={size / 2 + 4} viewBox={`0 0 ${size} ${size / 2 + 4}`}>
        <path
          d={`M ${stroke / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${stroke / 2} ${cy} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
        {/* Threshold notch */}
        <line
          x1={cx + Math.cos(thresholdRad) * (radius - stroke)}
          y1={cy - Math.sin(thresholdRad) * (radius - stroke)}
          x2={cx + Math.cos(thresholdRad) * (radius + stroke)}
          y2={cy - Math.sin(thresholdRad) * (radius + stroke)}
          stroke="var(--text)"
          strokeWidth={2}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: size / 2 - 34,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 30, fontWeight: 600, color, letterSpacing: "-0.02em" }}
        >
          {score.toFixed(1)}
          <span style={{ fontSize: 16, color: "var(--text-faint)" }}>%</span>
        </div>
        <div className="label" style={{ marginTop: 2 }}>
          gate {threshold}%
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ children }: { children: ReactNode }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 13,
      }}
    >
      {children}
    </table>
  );
}

export function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="label"
      style={{
        textAlign: align,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={mono ? "mono" : undefined}
      style={{
        textAlign: align,
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        color: "var(--text)",
      }}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — an empty screen is an invitation to act
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "56px 24px",
        textAlign: "center",
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 420, margin: "0 auto" }}>
        {description}
      </div>
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

export function CodeLine({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "neutral" | "original" | "mutated";
}) {
  const accent = {
    neutral: { border: "var(--border)", bg: "var(--bg)" },
    original: { border: "var(--border-strong)", bg: "var(--bg)" },
    mutated: { border: "var(--survived)", bg: "var(--survived-dim)" },
  }[variant];

  return (
    <div
      className="mono"
      style={{
        fontSize: 12.5,
        padding: "7px 10px",
        background: accent.bg,
        borderLeft: `2px solid ${accent.border}`,
        color: variant === "mutated" ? "var(--survived)" : "var(--text)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {children}
    </div>
  );
}
