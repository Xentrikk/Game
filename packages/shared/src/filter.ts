/**
 * Minimal profanity/slur filter for public text (handles, names, bios, item names, Say).
 *
 * This is a starting list, not a complete one. Before launch, replace or extend these lists with a
 * maintained, licensed word list and add non-English coverage (see docs/decisions.md).
 */

/** Blocked anywhere they appear, even inside another word. Only unambiguous terms belong here. */
const BLOCKED_SUBSTRINGS = [
  "fuck",
  "shit",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "whore",
  "bitch",
  "tranny",
  "kike",
  "nazi",
  "hitler",
  "motherf",
  "bastard",
  "asshole",
];

/** Blocked only as a whole word, because they appear inside innocent words (e.g. "grape", "peacock"). */
const BLOCKED_WORDS = [
  "ass",
  "arse",
  "cock",
  "cum",
  "dick",
  "dyke",
  "fag",
  "chink",
  "spic",
  "porn",
  "pussy",
  "penis",
  "vagina",
  "rape",
  "rapist",
  "slut",
  "tits",
  "twat",
  "wank",
  "sex",
  "kkk",
];

/** Innocent words that contain a blocked substring. Removed before the substring check. */
const ALLOWED_WORDS = ["scunthorpe", "penistone", "shitake", "shiitake", "cockburn", "dickens", "hancock"];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
};

/** Lowercases, removes accents and maps common look-alike characters to letters. */
export function normalizeForFilter(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0-9@$!|]/g, (c) => LEET[c] ?? c);
}

/** Collapses runs of the same letter ("fuuuck" → "fuck") so stretched spellings are caught. */
function squeeze(text: string): string {
  return text.replace(/(.)\1+/g, "$1");
}

export function containsProfanity(text: string): boolean {
  let normalized = normalizeForFilter(text);
  for (const ok of ALLOWED_WORDS) normalized = normalized.split(ok).join(" ");
  const lettersOnly = normalized.replace(/[^a-z]/g, "");
  const squeezed = squeeze(lettersOnly);
  for (const bad of BLOCKED_SUBSTRINGS) {
    if (lettersOnly.includes(bad) || squeezed.includes(squeeze(bad))) return true;
  }
  const words = normalized.split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    if (BLOCKED_WORDS.includes(word) || BLOCKED_WORDS.includes(squeeze(word))) return true;
  }
  return false;
}
