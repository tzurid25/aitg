import { prisma } from "@aitg/database";
import type { AuthContext } from "./auth";

export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export interface QuotaState {
  used: number;
  limit: number;
  resetsAt: Date;
  remaining: number;
}

/**
 * Rolls the counter over if we've passed the reset date. Called on read so
 * that a dormant organization's quota resets correctly without needing a
 * scheduled job — the first request of a new period does the work.
 */
async function rollOverIfDue(organizationId: string): Promise<QuotaState> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      monthlyMutationQuota: true,
      monthlyMutationsUsed: true,
      quotaResetAt: true,
    },
  });

  const now = new Date();
  const periodEnd = new Date(org.quotaResetAt);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  if (now >= periodEnd) {
    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: { monthlyMutationsUsed: 0, quotaResetAt: now },
      select: {
        monthlyMutationQuota: true,
        monthlyMutationsUsed: true,
        quotaResetAt: true,
      },
    });
    const nextReset = new Date(updated.quotaResetAt);
    nextReset.setMonth(nextReset.getMonth() + 1);
    return {
      used: updated.monthlyMutationsUsed,
      limit: updated.monthlyMutationQuota,
      resetsAt: nextReset,
      remaining: updated.monthlyMutationQuota,
    };
  }

  return {
    used: org.monthlyMutationsUsed,
    limit: org.monthlyMutationQuota,
    resetsAt: periodEnd,
    remaining: Math.max(0, org.monthlyMutationQuota - org.monthlyMutationsUsed),
  };
}

export async function getQuota(auth: AuthContext): Promise<QuotaState> {
  return rollOverIfDue(auth.organizationId);
}

/**
 * Checks and consumes quota in a single atomic step.
 *
 * The `updateMany` with a `monthlyMutationsUsed` predicate is doing real
 * work here: it makes the check-and-increment one statement, so two
 * concurrent CI jobs can't both read "under quota" and both proceed. If the
 * predicate no longer holds by the time the write lands, zero rows update
 * and we reject — rather than silently overshooting the limit.
 */
export async function consumeQuota(
  auth: AuthContext,
  mutantCount: number,
): Promise<QuotaState> {
  const current = await rollOverIfDue(auth.organizationId);

  if (current.used + mutantCount > current.limit) {
    throw new QuotaExceededError(
      `This scan would use ${mutantCount} mutants, but only ${current.remaining} remain ` +
        `in this billing period (${current.used}/${current.limit} used).`,
      current.used,
      current.limit,
    );
  }

  const result = await prisma.organization.updateMany({
    where: {
      id: auth.organizationId,
      monthlyMutationsUsed: { lte: current.limit - mutantCount },
    },
    data: { monthlyMutationsUsed: { increment: mutantCount } },
  });

  if (result.count === 0) {
    // Lost the race against a concurrent scan.
    const refreshed = await rollOverIfDue(auth.organizationId);
    throw new QuotaExceededError(
      "Quota was exhausted by a concurrent scan.",
      refreshed.used,
      refreshed.limit,
    );
  }

  return {
    ...current,
    used: current.used + mutantCount,
    remaining: current.limit - current.used - mutantCount,
  };
}
