/**
 * Run severity.
 *
 * The distinction this exists to enforce: a scan that *broke* and a scan that
 * *ran and found weak tests* are not the same event, and treating them the
 * same is how a silently broken pipeline hides for weeks.
 *
 * If Stryker crashes, or no test runner is found, or the suite fails before
 * mutation starts, the mutation score is meaningless — often 0, or absent.
 * Rendering that as "score too low" tells a team to go write tests, when the
 * actual problem is that their scan hasn't run since Tuesday.
 *
 * Functionality before quality: P0 always outranks any score-based outcome.
 */

export type RunSeverity =
  | "P0_SCAN_BROKEN"
  | "P1_GATE_FAILED"
  | "P2_GATE_WARNING"
  | "P3_HEALTHY";

export const SEVERITY_ORDER: Record<RunSeverity, number> = {
  P0_SCAN_BROKEN: 0,
  P1_GATE_FAILED: 1,
  P2_GATE_WARNING: 2,
  P3_HEALTHY: 3,
};

export interface SeverityInput {
  /** True when the scan could not run or complete. */
  scanFailed: boolean;
  /** Null when no gate is configured — absence is not a failure. */
  gateStatus: "PASSED" | "FAILED" | "WARNING" | null;
  /** Total mutants generated. Zero on a completed run is itself suspicious. */
  mutantsTotal: number;
}

export interface SeverityVerdict {
  severity: RunSeverity;
  /** One line, stating the situation and the next action. */
  headline: string;
  /** Whether this should block a merge. */
  blocking: boolean;
}

export function resolveSeverity(input: SeverityInput): SeverityVerdict {
  if (input.scanFailed) {
    return {
      severity: "P0_SCAN_BROKEN",
      headline:
        "The scan did not complete. No mutation score was produced — fix the scan before reading anything into the result.",
      blocking: true,
    };
  }

  // A "successful" run that produced no mutants is almost always a
  // misconfiguration: wrong paths, an over-broad exclude, or a diff that
  // matched nothing. Reporting it as a perfect score would be actively
  // misleading, so it is treated as broken.
  if (input.mutantsTotal === 0) {
    return {
      severity: "P0_SCAN_BROKEN",
      headline:
        "The scan completed but generated no mutants. Check that your diff touches production code and that exclude patterns aren't too broad.",
      blocking: true,
    };
  }

  if (input.gateStatus === "FAILED") {
    return {
      severity: "P1_GATE_FAILED",
      headline: "Mutation score is below the threshold. This build is blocked.",
      blocking: true,
    };
  }

  if (input.gateStatus === "WARNING") {
    return {
      severity: "P2_GATE_WARNING",
      headline:
        "Mutation score is below the threshold, but this gate is set to warn rather than block.",
      blocking: false,
    };
  }

  return {
    severity: "P3_HEALTHY",
    headline: "Mutation score meets the threshold.",
    blocking: false,
  };
}

/** Sorts runs so the ones needing attention surface first. */
export function bySeverity<T extends { severity: RunSeverity; createdAt: Date | string }>(
  a: T,
  b: T,
): number {
  const order = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (order !== 0) return order;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export const SEVERITY_LABEL: Record<RunSeverity, string> = {
  P0_SCAN_BROKEN: "Scan broken",
  P1_GATE_FAILED: "Gate failed",
  P2_GATE_WARNING: "Warning",
  P3_HEALTHY: "Healthy",
};

/**
 * Colour semantics. P0 is red because it genuinely is an error — which is
 * exactly why survivors are amber elsewhere in the product. Reserving red for
 * real breakage is what keeps it meaningful.
 */
export const SEVERITY_COLOR: Record<RunSeverity, string> = {
  P0_SCAN_BROKEN: "var(--fail)",
  P1_GATE_FAILED: "var(--survived)",
  P2_GATE_WARNING: "var(--timeout)",
  P3_HEALTHY: "var(--killed)",
};
