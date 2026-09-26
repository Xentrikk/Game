import type { ApiError } from "@hearth/shared";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Partial<Pick<ApiError, "retryAfterSec" | "attemptsLeft">> = {},
  ) {
    super(message);
  }

  toJSON(): ApiError {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

/** Shown when the age gate fails or a blocked account tries again. Deliberately neutral. */
export const NOT_ELIGIBLE_MESSAGE = "Sorry, you can't create a Hearth account right now.";
