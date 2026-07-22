import { z } from "zod";

/**
 * Replay payload — the minimum needed to reconstruct a scan session without
 * capturing source code.
 *
 * Every field here was chosen by asking "which support question does this
 * answer?" rather than "what could we collect?". Tool versions answer "works
 * on my machine". Timings answer "why is this slow". Failure stage answers
 * "where did it break". None of them require a line of the customer's code.
 */

export const changedFileSchema = z.object({
  path: z.string().max(1024),
  /** Inclusive [start, end] line ranges that were added or modified. */
  addedLines: z.array(z.tuple([z.number().int(), z.number().int()])).max(500),
});

export const replayPayloadSchema = z.object({
  cliVersion: z.string().max(32).optional(),
  strykerVersion: z.string().max(32).optional(),
  testRunner: z.string().max(64).optional(),
  nodeVersion: z.string().max(32).optional(),
  platform: z.string().max(64).optional(),

  baseRef: z.string().max(255).optional(),
  headSha: z.string().max(64).optional(),

  changedFiles: z.array(changedFileSchema).max(500).optional(),
  mutatedRanges: z.array(z.string().max(1100)).max(1000).optional(),

  diffDurationMs: z.number().int().nonnegative().optional(),
  mutationDurationMs: z.number().int().nonnegative().optional(),
  uploadDurationMs: z.number().int().nonnegative().optional(),

  failureStage: z.enum(["diff", "runner-detection", "mutation", "upload"]).optional(),
  // Truncated rather than rejected: a 40KB stack trace shouldn't fail the
  // upload, but neither should it be stored whole.
  failureMessage: z.string().max(4000).optional(),
});

export type ReplayPayload = z.infer<typeof replayPayloadSchema>;

/**
 * Strips anything that could carry source code before transmission.
 *
 * Belt and braces alongside the schema: error messages from test runners
 * routinely embed source lines ("Expected: foo(bar) ... at line 12: const x =
 * secret"), so the message is truncated and scanned for the obvious shapes.
 */
export function sanitizeReplay(payload: ReplayPayload): ReplayPayload {
  const cleaned = { ...payload };

  if (cleaned.failureMessage) {
    cleaned.failureMessage = cleaned.failureMessage
      .slice(0, 4000)
      // Collapse anything that looks like a quoted code fragment.
      .replace(/`[^`]{40,}`/g, "`<code omitted>`")
      .replace(/"[^"]{120,}"/g, '"<omitted>"');
  }

  return cleaned;
}
