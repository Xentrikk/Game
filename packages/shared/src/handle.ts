import { containsProfanity } from "./filter";

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 16;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,16}$/;

/** Handles that could be used to impersonate staff or the system. Also blocked as prefixes. */
const RESERVED = [
  "admin",
  "administrator",
  "mod",
  "moderator",
  "hearth",
  "support",
  "system",
  "staff",
  "official",
  "help",
  "root",
  "null",
  "undefined",
  "everyone",
  "here",
  "me",
  "you",
  "guest",
  "player",
  "server",
  "security",
  "team",
];
const RESERVED_PREFIXES = ["admin", "mod_", "hearth", "staff", "official", "support"];

export type HandleProblem = "length" | "characters" | "reserved" | "inappropriate";

/** Handles are case-insensitive; we store and compare them in lowercase. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateHandle(
  raw: string,
): { ok: true; handle: string } | { ok: false; problem: HandleProblem } {
  const handle = normalizeHandle(raw);
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) return { ok: false, problem: "length" };
  if (!HANDLE_PATTERN.test(handle)) return { ok: false, problem: "characters" };
  if (RESERVED.includes(handle.replace(/_/g, "")) || RESERVED_PREFIXES.some((p) => handle.startsWith(p))) {
    return { ok: false, problem: "reserved" };
  }
  if (containsProfanity(handle)) return { ok: false, problem: "inappropriate" };
  return { ok: true, handle };
}

export const HANDLE_PROBLEM_MESSAGES: Record<HandleProblem | "taken", string> = {
  length: `Handles are ${HANDLE_MIN}–${HANDLE_MAX} characters.`,
  characters: "Use only letters, numbers and underscores.",
  reserved: "That handle is reserved. Try another.",
  inappropriate: "That handle isn't allowed. Try another.",
  taken: "Someone already has that handle.",
};
