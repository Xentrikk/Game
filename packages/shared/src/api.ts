import { z } from "zod";
import { appearanceSchema, type Appearance } from "./appearance";
import { profileDetailsSchema } from "./profile";

/** Request/response shapes shared by apps/client and apps/server. */

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS_PER_HOUR = 3;
export const TOS_VERSION = "2026-09-draft";
export const PRIVACY_VERSION = "2026-09-draft";

export const channelSchema = z.enum(["phone", "email"]);
export type Channel = z.infer<typeof channelSchema>;

export const otpSendSchema = z.object({
  channel: channelSchema,
  target: z.string().trim().min(3).max(254),
  captchaToken: z.string().max(4096).optional(),
});
export type OtpSendRequest = z.infer<typeof otpSendSchema>;

export const otpVerifySchema = z.object({
  channel: channelSchema,
  target: z.string().trim().min(3).max(254),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});
export type OtpVerifyRequest = z.infer<typeof otpVerifySchema>;

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

export const ageSchema = z.object({ dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const termsSchema = z.object({ tosVersion: z.string(), privacyVersion: z.string() });
export const handleSchema = z.object({ handle: z.string().max(32) });
export const characterSchema = profileDetailsSchema.extend({ appearance: appearanceSchema });
export type CharacterRequest = z.infer<typeof characterSchema>;
export const linkSendSchema = z.object({ channel: channelSchema, target: z.string().trim().min(3).max(254) });
export const linkVerifySchema = linkSendSchema.extend({ code: z.string().regex(/^\d{6}$/) });

export interface Me {
  userId: string;
  phone: string | null;
  email: string | null;
  onboarding: {
    ageVerified: boolean;
    termsAccepted: boolean;
    handle: string | null;
    hasCharacter: boolean;
  };
  profile: { handle: string; displayName: string; pronouns: string; bio: string } | null;
  appearance: Appearance | null;
}

/** Every error response from the API has this shape. */
export interface ApiError {
  error: string;
  message: string;
  retryAfterSec?: number;
  attemptsLeft?: number;
}
