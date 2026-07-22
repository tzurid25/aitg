import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * BullMQ requires maxRetriesPerRequest: null on the connection it uses for
 * blocking commands. Sharing one connection object across queues avoids
 * opening a socket per queue.
 */
export const redisConnection: ConnectionOptions = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const QUEUE_NAMES = {
  reportProcessing: "report-processing",
  notification: "notification",
  billing: "billing",
} as const;

export interface ReportProcessingJob {
  testRunId: string;
  organizationId: string;
}

export interface NotificationJob {
  organizationId: string;
  testRunId: string;
  event: "quality.failed" | "scan.completed";
}

export interface BillingJob {
  organizationId: string;
  event: "usage.recorded";
  mutantCount: number;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  // Keep a bounded window of finished jobs so Redis memory stays flat.
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
};

export const reportProcessingQueue = new Queue<ReportProcessingJob>(
  QUEUE_NAMES.reportProcessing,
  { connection: redisConnection, defaultJobOptions },
);

export const notificationQueue = new Queue<NotificationJob>(QUEUE_NAMES.notification, {
  connection: redisConnection,
  defaultJobOptions,
});

export const billingQueue = new Queue<BillingJob>(QUEUE_NAMES.billing, {
  connection: redisConnection,
  defaultJobOptions,
});
