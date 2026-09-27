/** Errors raised by the economy repos, mapped to HTTP responses by the routes. */
export class EconomyError extends Error {
  constructor(
    public code:
      | "unknown_item"
      | "not_for_sale"
      | "not_sellable"
      | "not_tradeable"
      | "exceeds_max_stack"
      | "insufficient_coins"
      | "insufficient_items"
      | "trade_cooldown"
      | "trade_not_open"
      | "trade_not_found"
      | "not_a_participant"
      | "not_both_ready"
      | "tile_taken"
      | "not_furniture"
      | "letter_not_found"
      | "stationery_not_owned",
  ) {
    super(code);
  }
}

/** Postgres surfaces a `RAISE EXCEPTION '<msg>'` with that exact string as the error message. */
function pgMessage(e: unknown): string {
  return e instanceof Error ? e.message : "";
}

/** Maps a Postgres error from one of the SQL functions in the Phase 4 migration to an EconomyError. */
export function mapEconomyPgError(e: unknown): never {
  const msg = pgMessage(e);
  const code = (e as { code?: string }).code;
  const constraint = (e as { constraint_name?: string }).constraint_name;
  if (msg.includes("insufficient_items")) throw new EconomyError("insufficient_items");
  if (msg.includes("trade_cooldown")) throw new EconomyError("trade_cooldown");
  if (msg.includes("trade_not_open")) throw new EconomyError("trade_not_open");
  if (msg.includes("trade_not_found")) throw new EconomyError("trade_not_found");
  if (msg.includes("not_a_participant")) throw new EconomyError("not_a_participant");
  if (msg.includes("not_both_ready")) throw new EconomyError("not_both_ready");
  if (code === "23514" && constraint?.includes("balance")) throw new EconomyError("insufficient_coins");
  if (code === "23505" && constraint?.includes("home_furniture")) throw new EconomyError("tile_taken");
  throw e instanceof Error ? e : new Error(String(e));
}
