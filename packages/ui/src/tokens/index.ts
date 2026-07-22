/**
 * Design tokens for AI Test Integrity Guard.
 *
 * Semantic decisions worth stating, because they're not arbitrary:
 *
 * - SURVIVED is amber, not red. A surviving mutant is not a broken build —
 *   it's a blind spot in the test suite. Red reads as "error, something is
 *   broken"; amber reads as "look here." Reserving red for actual failures
 *   (a crashed run, a failed gate) keeps the signal honest.
 * - NO_COVERAGE is a desaturated violet-gray: it denotes absence, not
 *   failure, and shouldn't compete for attention with survivors.
 * - The surface is a cool slate ink rather than near-black. Pure black with
 *   a single acid accent is the default "developer tool" look; a cooler,
 *   slightly blue ground reads as clinical/instrument rather than terminal.
 */

export const colors = {
  // Surfaces — ascending elevation
  bg: "#0B0F14",
  surface: "#111720",
  surfaceRaised: "#161E29",
  surfaceOverlay: "#1C2634",

  // Hairlines
  border: "#212C3B",
  borderStrong: "#2E3C4F",

  // Text
  text: "#E6EDF5",
  textMuted: "#8DA0B8",
  textFaint: "#5A6D85",

  // Mutant statuses — the core semantic palette
  killed: "#2DD4BF",
  killedDim: "#134E4A",
  survived: "#F5A524",
  survivedDim: "#4A3211",
  noCoverage: "#7C7A99",
  noCoverageDim: "#2A2A3A",
  timeout: "#60A5FA",
  timeoutDim: "#1E3A5F",
  runtimeError: "#F26D6D",
  runtimeErrorDim: "#4A1D1D",

  // Gate verdicts
  pass: "#2DD4BF",
  warn: "#F5A524",
  fail: "#F26D6D",

  accent: "#5EEAD4",
} as const;

export const fonts = {
  sans: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/** 4px base scale. */
export const space = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "24px",
  6: "32px",
  7: "48px",
  8: "64px",
} as const;

export const radii = {
  sm: "4px",
  md: "6px",
  lg: "10px",
  full: "9999px",
} as const;

export const type = {
  display: { size: "28px", weight: 600, tracking: "-0.02em" },
  h1: { size: "20px", weight: 600, tracking: "-0.01em" },
  h2: { size: "15px", weight: 600, tracking: "0" },
  body: { size: "14px", weight: 400, tracking: "0" },
  small: { size: "13px", weight: 400, tracking: "0" },
  // Uppercase mono eyebrows carry section labels and data headers. This is
  // the utility voice of the interface.
  label: { size: "11px", weight: 500, tracking: "0.08em" },
} as const;

import type { MutantStatus } from "@aitg/shared";

export const statusColor: Record<MutantStatus, { fg: string; bg: string; label: string }> = {
  KILLED: { fg: colors.killed, bg: colors.killedDim, label: "Killed" },
  SURVIVED: { fg: colors.survived, bg: colors.survivedDim, label: "Survived" },
  TIMEOUT: { fg: colors.timeout, bg: colors.timeoutDim, label: "Timed out" },
  NO_COVERAGE: { fg: colors.noCoverage, bg: colors.noCoverageDim, label: "No coverage" },
  RUNTIME_ERROR: { fg: colors.runtimeError, bg: colors.runtimeErrorDim, label: "Runtime error" },
  IGNORED: { fg: colors.textFaint, bg: colors.surfaceRaised, label: "Ignored" },
};
