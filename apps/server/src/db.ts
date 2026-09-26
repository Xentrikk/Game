import postgres from "postgres";

export type Sql = postgres.Sql;

/** One pool per process. Queries run as the database owner, so every query must be scoped by user id. */
export function connectDb(url: string): Sql {
  return postgres(url, { max: 10, idle_timeout: 30, transform: { undefined: null } });
}
