import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_TTL_SECONDS,
  isE164,
  normalizePhone,
  type Channel,
  type SessionTokens,
} from "@hearth/shared";
import type { CaptchaVerifier } from "./captcha";
import { HttpError, NOT_ELIGIBLE_MESSAGE } from "./errors";
import { AuthApiError, type AuthApi } from "./gotrue";
import type { Store } from "./store";

/** Per-IP limits, on top of the per-target limits from the spec. */
export interface IpLimits {
  sendsPerHour: number;
  verifiesPer5Min: number;
}
export const DEFAULT_IP_LIMITS: IpLimits = { sendsPerHour: 10, verifiesPer5Min: 30 };

interface OtpState {
  sentAt: number;
  attempts: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeTarget(channel: Channel, raw: string): string {
  if (channel === "phone") {
    const phone = normalizePhone(raw);
    if (!isE164(phone))
      throw new HttpError(400, "invalid_phone", "Enter a phone number with its country code.");
    return phone;
  }
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254)
    throw new HttpError(400, "invalid_email", "Enter a valid email address.");
  return email;
}

export class OtpService {
  constructor(
    private store: Store,
    private auth: AuthApi,
    private captcha: CaptchaVerifier,
    private redirectTo: string,
    private now: () => number = Date.now,
    private ipLimits: IpLimits = DEFAULT_IP_LIMITS,
  ) {}

  private async limit(key: string, max: number, windowSec: number, message: string) {
    const { count, ttlSec } = await this.store.incr(key, windowSec);
    if (count > max)
      throw new HttpError(429, "rate_limited", message, { retryAfterSec: Math.max(ttlSec, 1) });
  }

  /** Checks limits and records a fresh code window. `purpose` separates sign-in from linking codes. */
  private async beforeSend(purpose: string, channel: Channel, target: string, ip: string) {
    await this.limit(
      `rl:otp-send-ip:${ip}`,
      this.ipLimits.sendsPerHour,
      3600,
      "Too many codes requested. Try again later.",
    );
    // Shared across sign-in and linking, so linking can't be used to get around the per-target limit.
    await this.limit(
      `rl:otp-send:${channel}:${target}`,
      OTP_MAX_SENDS_PER_HOUR,
      3600,
      "Too many codes sent to this address. Try again later.",
    );
    await this.store.setJson(
      `otp:${purpose}:${channel}:${target}`,
      { sentAt: this.now(), attempts: 0 },
      OTP_TTL_SECONDS,
    );
  }

  /** Counts an attempt and throws if the code window is expired or used up. */
  private async beforeVerify(purpose: string, channel: Channel, target: string, ip: string) {
    await this.limit(
      `rl:otp-verify-ip:${ip}`,
      this.ipLimits.verifiesPer5Min,
      300,
      "Too many attempts. Try again later.",
    );
    const key = `otp:${purpose}:${channel}:${target}`;
    const state = await this.store.getJson<OtpState>(key);
    const ageSec = state ? (this.now() - state.sentAt) / 1000 : Infinity;
    if (!state || ageSec >= OTP_TTL_SECONDS) {
      throw new HttpError(410, "code_expired", "That code has expired. Request a new one.");
    }
    if (state.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpError(429, "too_many_attempts", "Too many wrong codes. Request a new one.");
    }
    state.attempts += 1;
    await this.store.setJson(key, state, Math.ceil(OTP_TTL_SECONDS - ageSec));
    return { key, attemptsLeft: OTP_MAX_ATTEMPTS - state.attempts };
  }

  private wrongCode(attemptsLeft: number) {
    return attemptsLeft > 0
      ? new HttpError(400, "invalid_code", "That code isn't right.", { attemptsLeft })
      : new HttpError(429, "too_many_attempts", "Too many wrong codes. Request a new one.", {
          attemptsLeft: 0,
        });
  }

  async send(channel: Channel, rawTarget: string, captchaToken: string | undefined, ip: string) {
    const target = normalizeTarget(channel, rawTarget);
    if (!(await this.captcha.verify(captchaToken, ip))) {
      throw new HttpError(400, "captcha_failed", "Please complete the security check.");
    }
    await this.beforeSend("signin", channel, target, ip);
    try {
      await this.auth.sendOtp(channel, target, this.redirectTo);
    } catch (e) {
      throw mapAuthError(e);
    }
    return { target, expiresInSec: OTP_TTL_SECONDS };
  }

  async verify(channel: Channel, rawTarget: string, code: string, ip: string): Promise<SessionTokens> {
    const target = normalizeTarget(channel, rawTarget);
    const { key, attemptsLeft } = await this.beforeVerify("signin", channel, target, ip);
    try {
      const session = await this.auth.verifyOtp(channel, target, code);
      await this.store.del(key);
      return session;
    } catch (e) {
      if (e instanceof AuthApiError && isWrongCode(e)) throw this.wrongCode(attemptsLeft);
      throw mapAuthError(e);
    }
  }

  async startLink(userId: string, userJwt: string, channel: Channel, rawTarget: string, ip: string) {
    const target = normalizeTarget(channel, rawTarget);
    await this.beforeSend(`link:${userId}`, channel, target, ip);
    try {
      await this.auth.startLink(userJwt, channel, target);
    } catch (e) {
      throw mapAuthError(e);
    }
    return { target, expiresInSec: OTP_TTL_SECONDS };
  }

  async finishLink(
    userId: string,
    userJwt: string,
    channel: Channel,
    rawTarget: string,
    code: string,
    ip: string,
  ) {
    const target = normalizeTarget(channel, rawTarget);
    const { key, attemptsLeft } = await this.beforeVerify(`link:${userId}`, channel, target, ip);
    try {
      await this.auth.finishLink(userJwt, channel, target, code);
      await this.store.del(key);
    } catch (e) {
      if (e instanceof AuthApiError && isWrongCode(e)) throw this.wrongCode(attemptsLeft);
      throw mapAuthError(e);
    }
  }
}

function isWrongCode(e: AuthApiError) {
  return e.code === "otp_expired" || e.code === "otp_invalid" || /invalid|expired/i.test(e.message);
}

function mapAuthError(e: unknown): Error {
  if (e instanceof HttpError) return e;
  if (e instanceof AuthApiError) {
    if (e.code === "user_banned") return new HttpError(403, "not_eligible", NOT_ELIGIBLE_MESSAGE);
    if (e.code === "phone_exists" || e.code === "email_exists") {
      return new HttpError(409, "already_used", "That's already linked to another account.");
    }
    if (e.status === 429 || e.code.startsWith("over_")) {
      // Supabase says e.g. "you can only request this after 4 seconds".
      const wait = Number(/after (\d+) seconds?/.exec(e.message)?.[1] ?? 60);
      return new HttpError(429, "rate_limited", "Please wait a moment before asking for another code.", {
        retryAfterSec: wait,
      });
    }
    if (e.status >= 400 && e.status < 500) return new HttpError(400, "auth_rejected", e.message);
  }
  console.error("auth provider error", e);
  return new HttpError(502, "auth_unavailable", "Sign-in is having trouble right now. Try again soon.");
}
