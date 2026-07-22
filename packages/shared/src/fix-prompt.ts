import type { Mutant } from "./schemas";
import { triageSurvivors, type SurvivorGroup } from "./triage";

export interface FixPromptOptions {
  score: number;
  threshold: number;
  /** Scope the prompt to a single file. */
  filePath?: string;
  /** Distinct gaps to include. Default 10. */
  limit?: number;
}

const SEVERITY_LABEL: Record<SurvivorGroup["severity"], string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

/**
 * Builds a prompt a developer can paste straight into Claude, Cursor, or
 * Copilot and get usable tests back.
 *
 * The design constraint that matters most: this has to be a *task*, not a
 * report. An exhaustive list of every surviving mutant is technically
 * complete and practically useless — it overflows context windows, and a
 * developer who opens it decides to deal with it later, permanently. So the
 * prompt carries a capped, deduplicated, severity-ordered batch, and says
 * plainly how much was left out and how to get the rest.
 *
 * The rules section is doing real work too. Left unconstrained, a model
 * "fixes" a surviving mutant in one of two useless ways: it asserts the
 * mutated behaviour, or it edits the production code until the mutant can't
 * exist. Both kill the mutant and leave the suite exactly as weak.
 */
export function buildFixPrompt(survivors: Mutant[], options: FixPromptOptions): string {
  const { score, threshold, filePath, limit = 10 } = options;

  const triage = triageSurvivors(survivors, { limit, filePath });

  if (triage.groups.length === 0) {
    return [
      "# No action needed",
      "",
      `Every mutant was detected. Mutation score: ${score.toFixed(1)}% ` +
        `(threshold ${threshold}%).`,
      "",
    ].join("\n");
  }

  const lines: string[] = [];

  lines.push("# Task: fix weak tests found by mutation testing");
  lines.push("");

  // ---- Context -----------------------------------------------------------
  lines.push("## What happened");
  lines.push("");
  lines.push(
    "I ran mutation testing on my code. The tool made small, deliberate changes " +
      "to the production source and re-ran the test suite. The changes listed " +
      "below caused **no test to fail** — so the behaviour they alter is executed " +
      "by my tests but never actually verified. High coverage, no protection.",
  );
  lines.push("");
  lines.push(
    `Mutation score: **${score.toFixed(1)}%** (threshold ${threshold}%). ` +
      `${triage.totalSurvivors} mutant${triage.totalSurvivors === 1 ? "" : "s"} survived, ` +
      `representing ${triage.totalGroups} distinct testing gap${triage.totalGroups === 1 ? "" : "s"}.`,
  );
  lines.push("");

  if (triage.omittedGroups > 0) {
    lines.push(
      `Below are the **${triage.groups.length} highest-impact gaps**, ordered by severity. ` +
        `${triage.omittedGroups} lower-priority gap${triage.omittedGroups === 1 ? "" : "s"} ` +
        `${triage.omittedGroups === 1 ? "is" : "are"} omitted — fix these first, re-run the ` +
        "scan, and the next batch will be smaller.",
    );
    lines.push("");
  }

  // ---- The gaps ----------------------------------------------------------
  lines.push("## Testing gaps to close");
  lines.push("");

  triage.groups.forEach((group, index) => {
    const location =
      group.occurrences === 1
        ? `line ${group.lines[0]}`
        : `${group.occurrences} places — lines ${formatLines(group.lines)}`;

    lines.push(
      `### ${index + 1}. \`${group.filePath}\` — ${location}  ·  ${SEVERITY_LABEL[group.severity]}`,
    );
    lines.push("");

    if (group.originalCode) {
      lines.push("```diff");
      lines.push(`- ${group.originalCode}`);
      if (group.mutatedCode) lines.push(`+ ${group.mutatedCode}`);
      lines.push("```");
      lines.push("");
    }

    lines.push(`*${group.rationale}*`);
    lines.push("");
  });

  // ---- The ask -----------------------------------------------------------
  lines.push("## What I need from you");
  lines.push("");
  lines.push(
    "For each gap above, write or amend a test so that it **fails** if that " +
      "change were applied, and **passes** against the current, correct code.",
  );
  lines.push("");
  lines.push(
    "Where a gap recurs across several lines, one well-chosen test may close " +
      "all of them — say so rather than writing near-duplicate tests.",
  );
  lines.push("");

  lines.push("## Rules");
  lines.push("");
  lines.push(
    "1. **Do not modify the production code.** It is correct. The tests are the problem.",
  );
  lines.push(
    "2. **Do not assert the mutated behaviour.** The goal is a test that catches " +
      "the change, not one that accepts it.",
  );
  lines.push(
    "3. **Assert observable behaviour, not implementation.** Check what the code " +
      "returns or does — not that some internal function was called.",
  );
  lines.push(
    "4. **No circular mocks.** A test that mocks the thing it is meant to verify " +
      "proves nothing.",
  );
  lines.push(
    "5. **Hit the boundary directly.** A surviving conditional usually means the " +
      "edge case is untested: if `x > 10` survives becoming `x >= 10`, the missing " +
      "case is exactly `x === 10`.",
  );
  lines.push(
    "6. **Tell me which gap each test closes**, in one line, so I can verify the " +
      "mapping.",
  );
  lines.push(
    "7. **If a gap is genuinely not worth testing** — dead code, an unreachable " +
      "branch, a trivial accessor — say so instead of writing a hollow test. A " +
      "wrong test is worse than an acknowledged gap.",
  );
  lines.push("");

  return lines.join("\n");
}

/** "12, 44, 57" — or "12, 44, 57 and 9 more" once the list stops being readable. */
function formatLines(lines: number[]): string {
  const shown = lines.slice(0, 6);
  const rest = lines.length - shown.length;
  const joined = shown.join(", ");
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}
