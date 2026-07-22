import { replayPayloadSchema } from "./replay";
import { z } from "zod";

/**
 * These schemas are the contract between the CLI, the API, and the
 * dashboard. Defining them once means a change to the wire format is a
 * type error in every consumer rather than a runtime surprise.
 */

// ---------------------------------------------------------------------------
// Device auth (CLI login)
// ---------------------------------------------------------------------------

export const deviceAuthStartResponseSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  pollIntervalSeconds: z.number().int().positive(),
});
export type DeviceAuthStartResponse = z.infer<typeof deviceAuthStartResponseSchema>;

export const deviceAuthPollRequestSchema = z.object({
  deviceCode: z.string().min(1),
});
export type DeviceAuthPollRequest = z.infer<typeof deviceAuthPollRequestSchema>;

export const deviceAuthPollResponseSchema = z.object({
  status: z.enum(["pending", "approved", "expired"]),
  apiKey: z.string().optional(),
  organizationId: z.string().optional(),
  organizationSlug: z.string().optional(),
  userEmail: z.string().email().optional(),
});
export type DeviceAuthPollResponse = z.infer<typeof deviceAuthPollResponseSchema>;

// ---------------------------------------------------------------------------
// Projects & repositories
// ---------------------------------------------------------------------------

export const projectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const repositoryProviderSchema = z.enum([
  "GITHUB",
  "GITLAB",
  "BITBUCKET",
  "MANUAL",
]);

export const linkRepositoryRequestSchema = z.object({
  projectSlug: z.string().min(1),
  fullName: z.string().min(1).max(255),
  defaultBranch: z.string().min(1).max(255),
  provider: repositoryProviderSchema,
});
export type LinkRepositoryRequest = z.infer<typeof linkRepositoryRequestSchema>;

export const linkRepositoryResponseSchema = z.object({
  repositoryId: z.string(),
  project: projectSchema,
});
export type LinkRepositoryResponse = z.infer<typeof linkRepositoryResponseSchema>;

// ---------------------------------------------------------------------------
// Scan upload
// ---------------------------------------------------------------------------

export const mutantStatusSchema = z.enum([
  "KILLED",
  "SURVIVED",
  "TIMEOUT",
  "NO_COVERAGE",
  "RUNTIME_ERROR",
  "IGNORED",
]);

export const mutantSchema = z.object({
  id: z.string(),
  filePath: z.string().max(1024),
  lineNumber: z.number().int().nonnegative(),
  columnNumber: z.number().int().nonnegative().optional(),
  mutatorName: z.string().max(128),
  status: mutantStatusSchema,
  originalCode: z.string().max(2000).optional(),
  mutatedCode: z.string().max(2000).optional(),
  killedByTest: z.string().max(512).optional(),
});
export type Mutant = z.infer<typeof mutantSchema>;

export const mutationScoreSchema = z.object({
  score: z.number().min(0).max(100),
  total: z.number().int().nonnegative(),
  killed: z.number().int().nonnegative(),
  survived: z.number().int().nonnegative(),
  timedOut: z.number().int().nonnegative(),
  noCoverage: z.number().int().nonnegative(),
  runtimeErrors: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
});
export type MutationScore = z.infer<typeof mutationScoreSchema>;

export const scanTriggerSchema = z.enum([
  "CLI",
  "GITHUB_PR",
  "GITHUB_PUSH",
  "MANUAL",
  "SCHEDULED",
]);

/**
 * Upper bound on mutants per upload. A report far larger than this is
 * either a misconfigured scan (whole-repo instead of diff-scoped) or an
 * attempt to exhaust storage — either way we reject it rather than persist
 * hundreds of thousands of rows.
 */
export const MAX_MUTANTS_PER_SCAN = 50_000;

export const uploadScanRequestSchema = z.object({
  repositoryId: z.string().min(1),
  // Set when the scan itself broke. Present so a failed scan can still be
  // reported — a pipeline that goes silent on failure is worse than one that
  // reports a problem.
  scanFailed: z.boolean().optional(),
  replay: replayPayloadSchema.optional(),
  commitSha: z.string().min(7).max(64),
  branch: z.string().min(1).max(255),
  trigger: scanTriggerSchema,
  pullRequestNumber: z.number().int().positive().optional(),
  score: mutationScoreSchema,
  mutants: z.array(mutantSchema).max(MAX_MUTANTS_PER_SCAN),
  durationMs: z.number().int().nonnegative().optional(),
});
export type UploadScanRequest = z.infer<typeof uploadScanRequestSchema>;

export const uploadScanResponseSchema = z.object({
  testRunId: z.string(),
  dashboardUrl: z.string().url(),
  qualityGate: z
    .object({
      status: z.enum(["PASSED", "FAILED", "WARNING"]),
      reason: z.string(),
    })
    .optional(),
  quota: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
  }),
});
export type UploadScanResponse = z.infer<typeof uploadScanResponseSchema>;

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const whoamiResponseSchema = z.object({
  userEmail: z.string(),
  organizationSlug: z.string(),
  organizationId: z.string(),
  quota: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    resetsAt: z.string(),
  }),
});
export type WhoamiResponse = z.infer<typeof whoamiResponseSchema>;

export const apiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
