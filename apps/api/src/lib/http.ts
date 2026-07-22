import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { ApiAuthError } from "./auth";
import { QuotaExceededError } from "./quota";
import { RateLimitError } from "./rate-limit";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ message, code }, { status });
}

/**
 * Parses and validates a JSON body against a Zod schema, throwing a
 * ZodError that `handleRoute` converts into a 400 with field-level detail.
 */
export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ZodError([
      {
        code: "custom",
        path: [],
        message: "Request body must be valid JSON.",
      },
    ]);
  }
  return schema.parse(raw);
}

/**
 * Single error boundary for every route handler. Keeping this in one place
 * means no endpoint can accidentally leak a stack trace or a Prisma error
 * message (which can contain table/column names) to a client.
 */
export function handleRoute(
  handler: (request: Request, context: { params: Record<string, string> }) => Promise<NextResponse>,
) {
  return async (
    request: Request,
    context: { params: Record<string, string> } = { params: {} },
  ): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (err) {
      if (err instanceof ApiAuthError) {
        return fail(err.message, err.status, err.code);
      }

      if (err instanceof QuotaExceededError) {
        return fail(err.message, 402, "QUOTA_EXCEEDED");
      }

      if (err instanceof RateLimitError) {
        // Retry-After is what makes a 429 actionable rather than just a
        // rejection — well-behaved clients and CI runners honour it.
        const response = fail(err.message, 429, "RATE_LIMITED");
        response.headers.set("Retry-After", String(err.result.resetSeconds));
        response.headers.set("X-RateLimit-Limit", String(err.result.limit));
        response.headers.set("X-RateLimit-Remaining", String(err.result.remaining));
        return response;
      }

      if (err instanceof ZodError) {
        const detail = err.errors
          .map((e) => (e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message))
          .join("; ");
        return fail(`Invalid request: ${detail}`, 400, "VALIDATION_ERROR");
      }

      // Anything unhandled is logged server-side and reported generically.
      console.error("[api] Unhandled error:", err);
      return fail("An unexpected error occurred.", 500, "INTERNAL_ERROR");
    }
  };
}
