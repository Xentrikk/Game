import type { ZodType, ZodTypeDef } from "zod";
import { HttpError } from "./errors";

/** Validates a request body with a shared zod schema, or throws a 400 with the first problem. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid request.";
    throw new HttpError(400, "invalid_request", message);
  }
  return result.data;
}
