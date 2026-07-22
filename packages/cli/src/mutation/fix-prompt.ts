import { buildFixPrompt } from "@aitg/shared";
import type { MutationRunResult } from "./types.js";

/**
 * Thin adapter over the shared prompt builder.
 *
 * The generation rules live in @aitg/shared rather than here because the
 * dashboard emits the same prompt. Two copies would drift, and a developer
 * who noticed the CLI and the web app disagreeing would rightly stop
 * trusting both.
 */
export function generateFixPrompt(params: {
  run: MutationRunResult;
  threshold: number;
  filePath?: string;
  limit?: number;
}): string {
  // Mutants Stryker skipped for lack of any covering test. These never reach
  // `survivors` (they didn't survive — they never ran), so without threading
  // them through explicitly the prompt would silently treat untested code as
  // if it were fine.
  const noCoverageMutants = params.run.mutants.filter((m) => m.status === "NO_COVERAGE");

  const countsByFile = new Map<string, number>();
  for (const mutant of noCoverageMutants) {
    countsByFile.set(mutant.filePath, (countsByFile.get(mutant.filePath) ?? 0) + 1);
  }

  const noCoverageFiles = [...countsByFile.entries()]
    .map(([filePath, count]) => ({ filePath, count }))
    .sort((a, b) => b.count - a.count || a.filePath.localeCompare(b.filePath));

  return buildFixPrompt(
    params.run.survivors.map((m) => ({
      id: m.id,
      filePath: m.filePath,
      lineNumber: m.lineNumber,
      columnNumber: m.columnNumber,
      mutatorName: m.mutatorName,
      status: m.status,
      originalCode: m.originalCode,
      mutatedCode: m.mutatedCode,
      killedByTest: m.killedByTest,
    })),
    {
      score: params.run.score.score,
      threshold: params.threshold,
      filePath: params.filePath,
      limit: params.limit,
      noCoverage: {
        total: noCoverageMutants.length,
        files: params.filePath
          ? noCoverageFiles.filter((f) => f.filePath === params.filePath)
          : noCoverageFiles,
      },
    },
  );
}
