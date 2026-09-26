import { z } from "zod";
import { containsProfanity } from "./filter";

export const DISPLAY_NAME_MAX = 20;
export const PRONOUNS_MAX = 20;
export const BIO_MAX = 80;

const clean = (field: string) => (value: string) =>
  !containsProfanity(value) || `${field} contains a word that isn't allowed.`;

function filtered(max: number, field: string, min = 0) {
  return z
    .string()
    .trim()
    .min(min, `${field} is required.`)
    .max(max, `${field} is at most ${max} characters.`)
    .refine((v) => clean(field)(v) === true, { message: `${field} contains a word that isn't allowed.` });
}

export const profileDetailsSchema = z.object({
  displayName: filtered(DISPLAY_NAME_MAX, "Display name", 1),
  pronouns: filtered(PRONOUNS_MAX, "Pronouns"),
  bio: filtered(BIO_MAX, "Bio"),
});
export type ProfileDetails = z.infer<typeof profileDetailsSchema>;
