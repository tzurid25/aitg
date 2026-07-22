import { Worker } from "bullmq";
import { prisma } from "@aitg/database";
import {
  QUEUE_NAMES,
  redisConnection,
  type ReportProcessingJob,
  type NotificationJob,
  type BillingJob,
} from "../lib/queues";

/**
 * Standalone worker process. Run with `pnpm --filter @aitg/api workers`.
 *
 * Deliberately separate from the Next.js server: a long mutation-report
 * rollup must not compete for the event loop with request handling, and the
 * two scale on different signals (requests/sec vs queue depth).
 */

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

// ---------------------------------------------------------------------------
// Report processing — post-upload aggregation
// ---------------------------------------------------------------------------

const reportWorker = new Worker<ReportProcessingJob>(
  QUEUE_NAMES.reportProcessing,
  async (job) => {
    const { testRunId, organizationId } = job.data;

    const run = await prisma.testRun.findFirst({
      where: { id: testRunId, organizationId },
      select: { id: true, repositoryId: true, mutationScore: true },
    });

    if (!run) {
      // The run was deleted between enqueue and processing. Not an error.
      return;
    }

    // Recompute survivor hot-spots: which files repeatedly produce surviving
    // mutants. This powers the dashboard's "weakest tested files" view and is
    // expensive enough that it shouldn't run inside the upload request.
    const hotspots = await prisma.mutant.groupBy({
      by: ["filePath"],
      where: { testRunId, organizationId, status: "SURVIVED" },
      _count: { _all: true },
      orderBy: { _count: { filePath: "desc" } },
      take: 10,
    });

    console.log(
      `[report-processing] run=${testRunId} score=${run.mutationScore} hotspots=${hotspots.length}`,
    );
  },
  { connection: redisConnection, concurrency: CONCURRENCY },
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const notificationWorker = new Worker<NotificationJob>(
  QUEUE_NAMES.notification,
  async (job) => {
    const { organizationId, testRunId, event } = job.data;

    // Slack/Discord/email dispatch lands with the integrations phase. The
    // queue and worker exist now so that the upload path's contract doesn't
    // change when they do.
    console.log(`[notification] org=${organizationId} run=${testRunId} event=${event}`);
  },
  { connection: redisConnection, concurrency: CONCURRENCY },
);

// ---------------------------------------------------------------------------
// Billing / usage
// ---------------------------------------------------------------------------

const billingWorker = new Worker<BillingJob>(
  QUEUE_NAMES.billing,
  async (job) => {
    const { organizationId, mutantCount } = job.data;

    // Usage is already reflected in Organization.monthlyMutationsUsed at
    // upload time (atomically). This worker exists to forward usage to the
    // billing provider for metered plans in Phase 8.
    console.log(`[billing] org=${organizationId} mutants=${mutantCount}`);
  },
  { connection: redisConnection, concurrency: 1 },
);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const workers = [reportWorker, notificationWorker, billingWorker];

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    console.error(`[${worker.name}] job ${job?.id} failed:`, err.message);
  });
}

async function shutdown(signal: string) {
  console.log(`\n[workers] ${signal} received, draining...`);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(`[workers] started (concurrency=${CONCURRENCY})`);
