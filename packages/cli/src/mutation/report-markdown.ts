import { triageSurvivors, survivorsByFile } from "@aitg/shared";
import type { MutationRunResult, MutantResult } from "./types.js";
import type { DiffResult } from "../engine/types.js";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function verdictLine(score: number, threshold: number): string {
  if (score >= threshold) {
    return `**PASSED** — mutation score ${score}% meets the ${threshold}% threshold.`;
  }
  return `**FAILED** — mutation score ${score}% is below the ${threshold}% threshold.`;
}

function groupByFile(mutants: MutantResult[]): Map<string, MutantResult[]> {
  const grouped = new Map<string, MutantResult[]>();
  for (const mutant of mutants) {
    const list = grouped.get(mutant.filePath) ?? [];
    list.push(mutant);
    grouped.set(mutant.filePath, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.lineNumber - b.lineNumber);
  }
  return grouped;
}

export function generateMarkdownReport(params: {
  run: MutationRunResult;
  diff: DiffResult;
  threshold: number;
  repositoryName: string;
}): string {
  const { run, diff, threshold, repositoryName } = params;
  const { score } = run;

  const lines: string[] = [];

  lines.push("# AI Test Integrity Guard — Scan Report");
  lines.push("");
  lines.push(verdictLine(score.score, threshold));
  lines.push("");
  lines.push(`- **Repository:** \`${repositoryName}\``);
  lines.push(`- **Base:** \`${diff.baseRef}\` (\`${diff.baseSha.slice(0, 7)}\`)`);
  lines.push(`- **Head:** \`${diff.headSha.slice(0, 7)}\``);
  lines.push(`- **Test runner:** ${run.testRunner}`);
  lines.push(`- **Duration:** ${formatDuration(run.durationMs)}`);
  lines.push("");

  lines.push("## Mutation score");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Killed | ${score.killed} |`);
  lines.push(`| **Survived** | **${score.survived}** |`);
  lines.push(`| Timed out | ${score.timedOut} |`);
  lines.push(`| No coverage | ${score.noCoverage} |`);
  lines.push(`| Runtime errors | ${score.runtimeErrors} |`);
  lines.push(`| Total mutants | ${score.total} |`);
  lines.push("");
  lines.push(
    `Score is calculated over covered code: \`(killed + timed out) / (killed + survived + timed out)\`.`,
  );
  lines.push("");

  if (score.noCoverage > 0) {
    lines.push(
      `> ${score.noCoverage} mutant(s) had **no test coverage at all**. These don't ` +
        `count against the score, but they mean changed code is running entirely unverified.`,
    );
    lines.push("");
  }

  if (run.survivors.length === 0) {
    lines.push("## Surviving mutants");
    lines.push("");
    lines.push("None. Every mutation in the changed code was detected by your tests.");
    lines.push("");
    return lines.join("\n");
  }

  // The report shows the same triaged, deduplicated view as the fix prompt.
  // Listing every survivor produces a document nobody acts on: the same
  // mutation repeated across forty lines is one testing gap, not forty.
  const survivorPayload = run.survivors.map((m) => ({
    id: m.id,
    filePath: m.filePath,
    lineNumber: m.lineNumber,
    columnNumber: m.columnNumber,
    mutatorName: m.mutatorName,
    status: m.status,
    originalCode: m.originalCode,
    mutatedCode: m.mutatedCode,
    killedByTest: m.killedByTest,
  }));

  const triage = triageSurvivors(survivorPayload, { limit: 10 });
  const byFile = survivorsByFile(survivorPayload);

  lines.push("## Where your tests are weakest");
  lines.push("");
  lines.push("| File | Surviving mutants | Distinct gaps |");
  lines.push("| --- | ---: | ---: |");
  for (const entry of byFile.slice(0, 8)) {
    lines.push(`| \`${entry.filePath}\` | ${entry.count} | ${entry.distinctGaps} |`);
  }
  lines.push("");

  lines.push("## Testing gaps, by priority");
  lines.push("");
  lines.push(
    `${run.survivors.length} surviving mutant${run.survivors.length === 1 ? "" : "s"} ` +
      `reduce to **${triage.totalGroups} distinct gap${triage.totalGroups === 1 ? "" : "s"}**. ` +
      `The highest-impact ${triage.groups.length} are listed below.`,
  );
  lines.push("");

  triage.groups.forEach((group, index) => {
    const where =
      group.occurrences === 1
        ? `line ${group.lines[0]}`
        : `${group.occurrences} places (lines ${group.lines.slice(0, 6).join(", ")}${group.lines.length > 6 ? ", …" : ""})`;

    lines.push(
      `### ${index + 1}. \`${group.filePath}\` — ${where}  ·  ${group.severity.toUpperCase()}`,
    );
    lines.push("");
    if (group.originalCode) {
      lines.push("```diff");
      lines.push(`- ${group.originalCode}`);
      if (group.mutatedCode) lines.push(`+ ${group.mutatedCode}`);
      lines.push("```");
      lines.push("");
    }
    lines.push(group.rationale);
    lines.push("");
  });

  if (triage.omittedGroups > 0) {
    lines.push(
      `_${triage.omittedGroups} lower-priority gap${triage.omittedGroups === 1 ? "" : "s"} ` +
        "omitted. Close these first and re-scan — the next batch will be smaller._",
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "A ready-to-use prompt for fixing these tests is in `.test-guard/fix-prompt.md`.",
  );
  lines.push("");

  return lines.join("\n");
}
