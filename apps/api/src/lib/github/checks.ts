import { githubRequest } from "./client";
import { triageSurvivors, type Mutant } from "@aitg/shared";

/**
 * The PR surface: a check run (blocks merge) and one comment (explains why).
 *
 * Two deliberate choices about how this behaves in a pull request:
 *
 * 1. A **pending** check is opened as soon as the PR appears, before any scan
 *    has run. Without it, a PR whose CI never triggered shows no AITG status
 *    at all — indistinguishable from passing. Pending is the honest state.
 *
 * 2. The comment is **updated in place**, never re-posted. A bot that adds a
 *    fresh comment on every push is a bot people mute, and a muted quality
 *    gate protects nothing.
 */

const CHECK_NAME = "AITG / mutation score";
// Marker used to find our own comment on subsequent runs. Invisible in
// rendered markdown.
const COMMENT_MARKER = "<!-- aitg:mutation-report -->";

export interface CheckRunTarget {
  installationId: string;
  fullName: string;
  headSha: string;
}

export async function openPendingCheck(target: CheckRunTarget): Promise<string> {
  const result = await githubRequest<{ id: number }>({
    installationId: target.installationId,
    method: "POST",
    path: `/repos/${target.fullName}/check-runs`,
    body: {
      name: CHECK_NAME,
      head_sha: target.headSha,
      status: "in_progress",
      started_at: new Date().toISOString(),
      output: {
        title: "Waiting for a scan",
        summary:
          "No mutation report has been uploaded for this commit yet.\n\n" +
          "Run `aitg scan` in CI, or push again if your workflow did not trigger.",
      },
    },
  });

  return String(result.id);
}

export interface CheckConclusionInput extends CheckRunTarget {
  score: number;
  threshold: number;
  survived: number;
  total: number;
  noCoverage: number;
  passed: boolean;
  /** Warn-only gates report neutral rather than failure. */
  blocking: boolean;
  dashboardUrl: string;
  survivors: Mutant[];
}

export async function concludeCheck(input: CheckConclusionInput): Promise<void> {
  // "neutral" rather than "failure" for non-blocking gates: a red X that
  // doesn't actually block is noise, and teams learn to ignore it.
  const conclusion = input.passed ? "success" : input.blocking ? "failure" : "neutral";

  const triage = triageSurvivors(input.survivors, { limit: 5 });

  const summaryLines = [
    `**Mutation score: ${input.score.toFixed(1)}%** (threshold ${input.threshold}%)`,
    "",
    `| Killed | Survived | No coverage | Total |`,
    `| ---: | ---: | ---: | ---: |`,
    `| ${input.total - input.survived - input.noCoverage} | ${input.survived} | ${input.noCoverage} | ${input.total} |`,
    "",
  ];

  if (input.passed) {
    summaryLines.push("Every mutation in the changed code was caught by your tests.");
  } else {
    summaryLines.push(
      `${input.survived} mutation${input.survived === 1 ? "" : "s"} survived — ` +
        `code that your tests execute but do not verify.`,
    );
  }

  const detailLines: string[] = [];
  if (triage.groups.length > 0) {
    detailLines.push("### Highest-impact gaps", "");
    for (const group of triage.groups) {
      const where =
        group.occurrences === 1
          ? `line ${group.lines[0]}`
          : `${group.occurrences}× from line ${group.lines[0]}`;
      detailLines.push(
        `**${group.severity.toUpperCase()}** · \`${group.filePath}\` ${where}`,
        "",
        "```diff",
        `- ${group.originalCode ?? ""}`,
        `+ ${group.mutatedCode ?? ""}`,
        "```",
        "",
      );
    }
    if (triage.omittedGroups > 0) {
      detailLines.push(
        `_${triage.omittedGroups} further gap${triage.omittedGroups === 1 ? "" : "s"} not shown._`,
        "",
      );
    }
    detailLines.push(`[Full report and fix prompt →](${input.dashboardUrl})`);
  }

  await githubRequest({
    installationId: input.installationId,
    method: "POST",
    path: `/repos/${input.fullName}/check-runs`,
    body: {
      name: CHECK_NAME,
      head_sha: input.headSha,
      status: "completed",
      conclusion,
      completed_at: new Date().toISOString(),
      details_url: input.dashboardUrl,
      output: {
        title: input.passed
          ? `${input.score.toFixed(1)}% — passed`
          : `${input.score.toFixed(1)}% — ${input.survived} survived`,
        summary: summaryLines.join("\n"),
        text: detailLines.join("\n") || undefined,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// PR comment
// ---------------------------------------------------------------------------

interface IssueComment {
  id: number;
  body: string;
}

export interface PrCommentInput {
  installationId: string;
  fullName: string;
  pullRequestNumber: number;
  score: number;
  threshold: number;
  survived: number;
  passed: boolean;
  dashboardUrl: string;
  survivors: Mutant[];
}

export async function upsertPrComment(input: PrCommentInput): Promise<void> {
  const body = buildCommentBody(input);

  // Find our previous comment by marker rather than tracking its id in the
  // database — the comment can be deleted by a human, and a stale id would
  // produce a 404 on every subsequent push.
  const existing = await githubRequest<IssueComment[]>({
    installationId: input.installationId,
    path: `/repos/${input.fullName}/issues/${input.pullRequestNumber}/comments?per_page=100`,
  });

  const mine = existing.find((comment) => comment.body.includes(COMMENT_MARKER));

  if (mine) {
    await githubRequest({
      installationId: input.installationId,
      method: "PATCH",
      path: `/repos/${input.fullName}/issues/comments/${mine.id}`,
      body: { body },
    });
    return;
  }

  // Nothing to say on a first-time pass. Opening a PR conversation with
  // "everything is fine" trains people to skim past the comment that
  // eventually matters.
  if (input.passed) return;

  await githubRequest({
    installationId: input.installationId,
    method: "POST",
    path: `/repos/${input.fullName}/issues/${input.pullRequestNumber}/comments`,
    body: { body },
  });
}

function buildCommentBody(input: PrCommentInput): string {
  const triage = triageSurvivors(input.survivors, { limit: 5 });

  const lines = [COMMENT_MARKER, ""];

  if (input.passed) {
    lines.push(
      `### Mutation score: ${input.score.toFixed(1)}% ✓`,
      "",
      `Above the ${input.threshold}% threshold. Every mutation in the changed code was caught.`,
      "",
      `[View report →](${input.dashboardUrl})`,
    );
    return lines.join("\n");
  }

  lines.push(
    `### Mutation score: ${input.score.toFixed(1)}% — below the ${input.threshold}% threshold`,
    "",
    `${input.survived} mutation${input.survived === 1 ? "" : "s"} survived. ` +
      "That means this code runs during your tests, but no assertion would fail if its behaviour changed.",
    "",
  );

  for (const group of triage.groups) {
    const where =
      group.occurrences === 1
        ? `line ${group.lines[0]}`
        : `${group.occurrences} places from line ${group.lines[0]}`;

    lines.push(
      `<details>`,
      `<summary><strong>${group.severity.toUpperCase()}</strong> · <code>${group.filePath}</code> — ${where}</summary>`,
      "",
      "```diff",
      `- ${group.originalCode ?? ""}`,
      `+ ${group.mutatedCode ?? ""}`,
      "```",
      "",
      group.rationale,
      "",
      `</details>`,
      "",
    );
  }

  if (triage.omittedGroups > 0) {
    lines.push(
      `_${triage.omittedGroups} further gap${triage.omittedGroups === 1 ? "" : "s"} omitted. ` +
        "Close these first and re-run — the next batch will be smaller._",
      "",
    );
  }

  lines.push(
    `[Full report and copy-able fix prompt →](${input.dashboardUrl})`,
    "",
    "<sub>Coverage is not quality. Mutation score is.</sub>",
  );

  return lines.join("\n");
}
