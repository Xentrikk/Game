import type { Appearance, Channel, ProfileDetails } from "@hearth/shared";
import { createApp } from "../../src/app";
import { noCaptcha, type CaptchaVerifier } from "../../src/captcha";
import { AuthApiError, type AuthApi } from "../../src/gotrue";
import { OtpService } from "../../src/otp";
import { HandleTakenError, type PersonalData, type Profile, type Repo } from "../../src/repo";
import { MemoryStore } from "../../src/store";

export const GOOD_CODE = "123456";

/** Fake Supabase Auth: accepts GOOD_CODE, records calls, supports banning. */
export class FakeAuth implements AuthApi {
  sent: { channel: Channel; target: string }[] = [];
  banned = new Set<string>();
  users = new Map<string, { id: string; phone: string | null; email: string | null }>();

  private userFor(channel: Channel, target: string) {
    for (const u of this.users.values()) if (u[channel] === target) return u;
    const u = { id: `user-${this.users.size + 1}`, phone: null, email: null, [channel]: target };
    this.users.set(u.id, u);
    return u;
  }
  async sendOtp(channel: Channel, target: string) {
    this.sent.push({ channel, target });
  }
  async verifyOtp(channel: Channel, target: string, code: string) {
    if (code !== GOOD_CODE) throw new AuthApiError(403, "otp_expired", "Token has expired or is invalid");
    const u = this.userFor(channel, target);
    if (this.banned.has(u.id)) throw new AuthApiError(403, "user_banned", "User is banned");
    return { access_token: `token:${u.id}`, refresh_token: "r" };
  }
  async startLink(_jwt: string, channel: Channel, target: string) {
    for (const u of this.users.values()) {
      if (u[channel] === target) throw new AuthApiError(422, `${channel}_exists`, "exists");
    }
    this.sent.push({ channel, target });
  }
  async finishLink(jwt: string, channel: Channel, target: string, code: string) {
    if (code !== GOOD_CODE) throw new AuthApiError(403, "otp_expired", "Token has expired or is invalid");
    const u = this.users.get(jwt.replace("token:", ""));
    if (u) u[channel] = target;
  }
  async getUser(id: string) {
    return this.users.get(id) ?? { id, phone: null, email: null };
  }
  async ban(id: string) {
    this.banned.add(id);
  }
}

export class FakeRepo implements Repo {
  personal = new Map<string, PersonalData & { dob: string | null }>();
  profiles = new Map<string, Profile>();
  appearances = new Map<string, Appearance>();

  async getPersonal(id: string) {
    return this.personal.get(id) ?? null;
  }
  async markAgeVerified(id: string, dob: string) {
    this.personal.set(id, { dob, ageVerifiedAt: "now", ageBlockedAt: null, termsAcceptedAt: null });
  }
  async markAgeBlocked(id: string) {
    this.personal.set(id, { dob: null, ageVerifiedAt: null, ageBlockedAt: "now", termsAcceptedAt: null });
  }
  async acceptTerms(id: string) {
    const p = this.personal.get(id);
    if (p) p.termsAcceptedAt = "now";
  }
  async getProfile(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async handleTaken(handle: string) {
    return [...this.profiles.values()].some((p) => p.handle === handle);
  }
  async createProfile(id: string, handle: string) {
    if (await this.handleTaken(handle)) throw new HandleTakenError();
    this.profiles.set(id, { handle, displayName: handle, pronouns: "", bio: "" });
  }
  async saveCharacter(id: string, details: ProfileDetails, appearance: Appearance) {
    const p = this.profiles.get(id);
    if (!p) throw new Error("no profile");
    Object.assign(p, details);
    this.appearances.set(id, appearance);
  }
  async getAppearance(id: string) {
    return this.appearances.get(id) ?? null;
  }
}

export function makeTestApp(opts: { captcha?: CaptchaVerifier; today?: string } = {}) {
  let now = 1_000_000;
  const clock = {
    now: () => now,
    advance: (sec: number) => {
      now += sec * 1000;
    },
  };
  const store = new MemoryStore(clock.now);
  const auth = new FakeAuth();
  const repo = new FakeRepo();
  const otp = new OtpService(store, auth, opts.captcha ?? noCaptcha, "http://app/auth/callback", clock.now);
  const app = createApp({
    otp,
    auth,
    repo,
    // Test tokens are "token:<userId>".
    verifyToken: async (jwt) => {
      if (!jwt.startsWith("token:")) throw new Error("bad token");
      return jwt.slice(6);
    },
    corsOrigins: [],
    trustProxy: 0,
    today: () => opts.today ?? "2026-09-26",
  });
  return { app, auth, repo, clock };
}
