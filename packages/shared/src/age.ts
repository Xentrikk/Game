/** Minimum age to create an account. See PROMPT.md Section 0, decision 2. */
export const MIN_AGE = 13;

/** Oldest birth year we accept, to reject obviously invalid dates. */
export const MIN_BIRTH_YEAR = 1900;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a YYYY-MM-DD string into its parts, or returns null if it isn't a real calendar date. */
export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Whole years between a birth date and `today` (both YYYY-MM-DD). Returns null for invalid input. */
export function ageOn(dob: string, today: string): number | null {
  const b = parseIsoDate(dob);
  const t = parseIsoDate(today);
  if (!b || !t) return null;
  let age = t.year - b.year;
  if (t.month < b.month || (t.month === b.month && t.day < b.day)) age -= 1;
  return age;
}

export type AgeCheck = { ok: true; age: number } | { ok: false; reason: "invalid" | "too_young" };

export function checkAge(dob: string, today: string, minAge = MIN_AGE): AgeCheck {
  const b = parseIsoDate(dob);
  const age = ageOn(dob, today);
  if (!b || age === null || b.year < MIN_BIRTH_YEAR || age < 0) return { ok: false, reason: "invalid" };
  if (age < minAge) return { ok: false, reason: "too_young" };
  return { ok: true, age };
}

/** Today's date as YYYY-MM-DD in UTC. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
