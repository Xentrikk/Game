/** E.164: a plus sign, a non-zero country code digit, and 8–15 digits total. */
export const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string): boolean {
  return E164.test(value);
}

/** Strips spaces, dashes, dots and brackets so "+1 (555) 555-0100" becomes "+15555550100". */
export function normalizePhone(value: string): string {
  return value.replace(/[\s\-().]/g, "");
}
