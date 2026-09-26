import type { ApiError } from "@hearth/shared";

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.message);
  }
}

export function describeError(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.body.retryAfterSec && e.status === 429) {
      const s = e.body.retryAfterSec;
      if (s < 60) return `${e.message} (about ${s} second${s === 1 ? "" : "s"})`;
      const mins = Math.ceil(s / 60);
      return `${e.message} (about ${mins} min${mins === 1 ? "" : "s"})`;
    }
    if (e.body.attemptsLeft !== undefined && e.body.attemptsLeft > 0) {
      return `${e.message} ${e.body.attemptsLeft} ${e.body.attemptsLeft === 1 ? "try" : "tries"} left.`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
