import bcrypt from "bcryptjs";
import { prisma } from "./index";
import type { MutantStatus } from "@prisma/client";

/**
 * Development seed.
 *
 * Generates enough history to actually exercise the dashboard: the trend
 * chart needs a run series, the mutation strip needs hundreds of mutants,
 * and the survivor-hotspot query needs the same files failing repeatedly.
 * A single empty org would let all three render as empty states and hide
 * regressions.
 */

const SOURCE_FILES = [
  "src/pricing/calculate-discount.ts",
  "src/pricing/apply-tax.ts",
  "src/billing/invoice-builder.ts",
  "src/auth/session-guard.ts",
  "src/lib/date-range.ts",
];

/** Files that are genuinely weakly tested - these produce most survivors. */
const WEAK_FILES = ["src/pricing/calculate-discount.ts", "src/lib/date-range.ts"];

const CODE_SAMPLES = [
  { original: "if (quantity > 100) {", mutated: "if (quantity >= 100) {", mutator: "ConditionalExpression" },
  { original: "return total * (1 - rate);", mutated: "return total * (1 + rate);", mutator: "ArithmeticOperator" },
  { original: "if (user.role === 'admin') {", mutated: "if (user.role !== 'admin') {", mutator: "EqualityOperator" },
  { original: "const isExpired = now > expiresAt;", mutated: "const isExpired = now < expiresAt;", mutator: "ConditionalExpression" },
  { original: "return enabled && hasAccess;", mutated: "return enabled || hasAccess;", mutator: "LogicalOperator" },
  { original: "let attempts = 0;", mutated: "let attempts = 1;", mutator: "ArithmeticOperator" },
  { original: "if (!options.strict) {", mutated: "if (options.strict) {", mutator: "BooleanLiteral" },
  { original: "count += 1;", mutated: "count -= 1;", mutator: "UpdateOperator" },
];

/** Deterministic PRNG so repeated seeds produce the same fixture. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = makeRandom(20260720);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function generateMutants(count: number, targetScore: number) {
  const mutants = [];

  for (let i = 0; i < count; i++) {
    // Weak files are disproportionately likely to host a survivor, which is
    // what makes the hotspot view meaningful rather than uniform noise.
    const filePath = random() < 0.45 ? pick(WEAK_FILES) : pick(SOURCE_FILES);
    const weak = WEAK_FILES.includes(filePath);

    const roll = random() * 100;
    // Calibrated so the realized mutation score tracks targetScore within
    // ~1.5 points. Weak files are picked ~67% of the time overall, so the
    // two multipliers have to be weighted against that or every seeded run
    // lands well below its intended score.
    const survivalChance = weak ? (100 - targetScore) * 1.25 : (100 - targetScore) * 0.37;

    let status: MutantStatus;
    if (roll < survivalChance) status = "SURVIVED";
    else if (roll < survivalChance + 4) status = "NO_COVERAGE";
    else if (roll < survivalChance + 6) status = "TIMEOUT";
    else status = "KILLED";

    const sample = pick(CODE_SAMPLES);

    mutants.push({
      filePath,
      lineNumber: 10 + Math.floor(random() * 180),
      columnNumber: 3 + Math.floor(random() * 30),
      mutatorName: sample.mutator,
      status,
      originalCode: sample.original,
      mutatedCode: sample.mutated,
      killedByTest: status === "KILLED" ? `should handle ${filePath.split("/").pop()}` : null,
    });
  }

  return mutants;
}

async function main() {
  console.log("Seeding...");

  // Local-only credentials. Hashed rather than stored plainly even in a
  // fixture, because a seed file is exactly the place where a shortcut
  // quietly becomes the pattern everyone copies.
  const passwordHash = await bcrypt.hash("aitg-dev-1234", 10);

  const user = await prisma.user.upsert({
    where: { email: "dev@aitg.local" },
    update: { passwordHash },
    create: {
      email: "dev@aitg.local",
      name: "Local Dev",
      authProvider: "EMAIL",
      passwordHash,
      emailVerifiedAt: new Date(),
      lastLoginAt: new Date(),
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "local-dev-org" },
    update: {},
    create: {
      name: "Local Dev Org",
      slug: "local-dev-org",
      planId: "free",
      billingEmail: user.email,
      monthlyMutationQuota: 5000,
    },
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: { organizationId: organization.id, userId: user.id },
    },
    update: {},
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
      acceptedAt: new Date(),
    },
  });

  // Clear previous fixture data so re-seeding doesn't stack duplicate runs.
  await prisma.mutant.deleteMany({ where: { organizationId: organization.id } });
  await prisma.qualityGateResult.deleteMany({ where: { organizationId: organization.id } });
  await prisma.testRun.deleteMany({ where: { organizationId: organization.id } });
  await prisma.repository.deleteMany({ where: { organizationId: organization.id } });
  await prisma.qualityGate.deleteMany({ where: { organizationId: organization.id } });
  await prisma.project.deleteMany({ where: { organizationId: organization.id } });

  const projectSpecs = [
    { name: "Checkout Service", slug: "checkout-service", repo: "acme/checkout-service", threshold: 70 },
    { name: "Billing API", slug: "billing-api", repo: "acme/billing-api", threshold: 75 },
    { name: "Web Platform", slug: "web-platform", repo: "acme/web-platform", threshold: 60 },
  ];

  const branches = ["retry-logic", "tax-rules", "session-ttl", "bulk-import"];

  for (const [projectIndex, spec] of projectSpecs.entries()) {
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: spec.name,
        slug: spec.slug,
        description: `Mutation coverage for ${spec.name}`,
      },
    });

    // Every project gets a gate at creation. Without this, uploads never
    // produce a QualityGateResult and the verdict column stays empty.
    const gate = await prisma.qualityGate.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        name: "Default Quality Gate",
        minMutationScore: spec.threshold,
        failBuildOnBreach: true,
        isActive: true,
        excludePatterns: ["**/*.test.*", "**/migrations/**"],
      },
    });

    const repository = await prisma.repository.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        provider: "GITHUB",
        fullName: spec.repo,
        defaultBranch: "main",
        isActive: true,
      },
    });

    const runCount = 12 - projectIndex * 2;

    for (let i = runCount - 1; i >= 0; i--) {
      // Score trends upward over time so the chart shows improvement rather
      // than noise - the shape a team would actually expect to see.
      const base = spec.threshold - 18 + (runCount - i) * 2.4;
      const targetScore = Math.max(20, Math.min(96, base + (random() - 0.5) * 9));

      const mutantCount = 80 + Math.floor(random() * 220);
      const mutants = generateMutants(mutantCount, targetScore);

      const killed = mutants.filter((m) => m.status === "KILLED").length;
      const survived = mutants.filter((m) => m.status === "SURVIVED").length;
      const timedOut = mutants.filter((m) => m.status === "TIMEOUT").length;
      const noCoverage = mutants.filter((m) => m.status === "NO_COVERAGE").length;

      const denominator = killed + survived + timedOut;
      const score =
        denominator === 0 ? 100 : Math.round(((killed + timedOut) / denominator) * 10000) / 100;

      const createdAt = new Date(Date.now() - i * 36 * 60 * 60 * 1000);
      const durationMs = 45000 + Math.floor(random() * 200000);

      const testRun = await prisma.testRun.create({
        data: {
          organizationId: organization.id,
          repositoryId: repository.id,
          status: "COMPLETED",
          trigger: random() > 0.4 ? "GITHUB_PR" : "CLI",
          commitSha: Array.from(
            { length: 40 },
            () => "0123456789abcdef"[Math.floor(random() * 16)],
          ).join(""),
          branch: random() > 0.5 ? "main" : `feature/${pick(branches)}`,
          mutationScore: score,
          mutantsTotal: mutants.length,
          mutantsKilled: killed,
          mutantsSurvived: survived,
          mutantsTimedOut: timedOut,
          mutantsNoCoverage: noCoverage,
          createdAt,
          startedAt: new Date(createdAt.getTime() - durationMs),
          completedAt: createdAt,
        },
      });

      await prisma.mutant.createMany({
        data: mutants.map((m) => ({
          organizationId: organization.id,
          testRunId: testRun.id,
          ...m,
        })),
      });

      const passed = score >= spec.threshold;
      await prisma.qualityGateResult.create({
        data: {
          organizationId: organization.id,
          qualityGateId: gate.id,
          testRunId: testRun.id,
          status: passed ? "PASSED" : "FAILED",
          reason: passed
            ? "All thresholds met."
            : `mutation score ${score}% is below the ${spec.threshold}% threshold`,
        },
      });
    }

    console.log(`  ${spec.name}: ${runCount} runs`);
  }

  // ---- Demo runs for the P0 and replay paths -----------------------------
  // The generated runs above are all healthy-ish, so neither the broken-scan
  // banner nor the replay panel would ever render. These two exist so both
  // are visible without waiting for a real failure to occur.
  const firstRepo = await prisma.repository.findFirstOrThrow({
    where: { organizationId: organization.id },
    select: { id: true },
  });

  // P0: Stryker crashed. Note the score is null, not zero — a broken scan
  // produces no score at all, and storing 0 would read as "your tests are
  // terrible" rather than "this never ran".
  const brokenRun = await prisma.testRun.create({
    data: {
      organizationId: organization.id,
      repositoryId: firstRepo.id,
      status: "FAILED",
      severity: "P0_SCAN_BROKEN",
      trigger: "GITHUB_PR",
      commitSha: "f4c19ab27de3510b8a6d92e7c4f1b3a85d0e6297",
      branch: "feature/payment-retry",
      pullRequestNumber: 214,
      mutationScore: null,
      mutantsTotal: 0,
      mutantsKilled: 0,
      mutantsSurvived: 0,
      mutantsTimedOut: 0,
      mutantsNoCoverage: 0,
      createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000 - 41_000),
      completedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    },
  });

  await prisma.scanReplay.create({
    data: {
      organizationId: organization.id,
      testRunId: brokenRun.id,
      cliVersion: "0.1.0",
      strykerVersion: "8.6.0",
      testRunner: "vitest",
      nodeVersion: "v20.11.1",
      platform: "linux-x64",
      baseRef: "origin/main",
      headSha: "f4c19ab",
      changedFiles: [{ path: "src/billing/retry.ts", addedLines: [[44, 71]] }],
      mutatedRanges: ["src/billing/retry.ts:44-71"],
      diffDurationMs: 380,
      mutationDurationMs: 40_600,
      failureStage: "mutation",
      failureMessage:
        "Stryker exited unexpectedly: no TestRunner plugins were loaded.\n" +
        "Expected @stryker-mutator/vitest-runner to be resolvable from the project root.\n" +
        "Hint: install it as a devDependency alongside @stryker-mutator/core.",
    },
  });

  // A healthy run that carries a full replay record.
  const healthyRun = await prisma.testRun.findFirstOrThrow({
    where: { organizationId: organization.id, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, commitSha: true },
  });

  await prisma.scanReplay.create({
    data: {
      organizationId: organization.id,
      testRunId: healthyRun.id,
      cliVersion: "0.1.0",
      strykerVersion: "8.6.0",
      testRunner: "vitest",
      nodeVersion: "v20.11.1",
      platform: "linux-x64",
      baseRef: "origin/main",
      headSha: healthyRun.commitSha?.slice(0, 7) ?? null,
      changedFiles: [
        { path: "src/pricing/calculate-discount.ts", addedLines: [[12, 48]] },
        { path: "src/lib/date-range.ts", addedLines: [[7, 22]] },
      ],
      mutatedRanges: [
        "src/pricing/calculate-discount.ts:12-48",
        "src/lib/date-range.ts:7-22",
      ],
      diffDurationMs: 412,
      mutationDurationMs: 128_900,
      uploadDurationMs: 1_840,
    },
  });

  console.log("  Demo: 1 broken scan (P0) + 2 replay records");

  const totalMutants = await prisma.mutant.count({ where: { organizationId: organization.id } });
  await prisma.organization.update({
    where: { id: organization.id },
    data: { monthlyMutationsUsed: Math.min(totalMutants, 4200) },
  });

  console.log(`Seeded org="${organization.slug}" mutants=${totalMutants}`);
  console.log("");
  console.log("  Sign in at http://localhost:3000/login");
  console.log("    email:    dev@aitg.local");
  console.log("    password: aitg-dev-1234");
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
