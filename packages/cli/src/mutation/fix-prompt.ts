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
    },
  );
}
