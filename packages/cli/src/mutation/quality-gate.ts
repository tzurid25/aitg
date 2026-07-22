import type { MutationScore } from "./types.js";

export type QualityGateStatus = "PASSED" | "FAILED" | "WARNING";

export interface QualityGateEvaluation {
  status: QualityGateStatus;
  reason: string;
  /** Process exit code the CLI should use in CI. */
  exitCode: number;
}

export interface QualityGateConfig {
  minMutationScore: number;
  maxSurvivedMutants: number | null;
  failBuildOnBreach: boolean;
}

export function evaluateQualityGate(
  score: MutationScore,
  config: QualityGateConfig,
): QualityGateEvaluation {
  const breaches: string[] = [];

  if (score.score < config.minMutationScore) {
    breaches.push(
      `mutation score ${score.score}% is below the ${config.minMutationScore}% threshold`,
    );
  }

  if (config.maxSurvivedMutants !== null && score.survived > config.maxSurvivedMutants) {
    breaches.push(
      `${score.survived} surviving mutants exceeds the limit of ${config.maxSurvivedMutants}`,
    );
  }

  if (breaches.length === 0) {
    return {
      status: "PASSED",
      reason: `Mutation score ${score.score}% meets the ${config.minMutationScore}% threshold.`,
      exitCode: 0,
    };
  }

  const reason = breaches.join("; ");

  // When failBuildOnBreach is off the team still wants visibility, so we
  // report WARNING and exit 0 rather than silently passing.
  if (!config.failBuildOnBreach) {
    return { status: "WARNING", reason, exitCode: 0 };
  }

  return { status: "FAILED", reason, exitCode: 1 };
}
