import type { ApiError, Channel, CharacterRequest, Me, SessionTokens } from "@hearth/shared";
import { env } from "./env";
import { supabase } from "./supabase";

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, authed = true): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authed) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, { error: "offline", message: "Can't reach Hearth. Check your connection." });
  }
  const json = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const err = json as Partial<ApiError>;
    throw new ApiFailure(res.status, {
      error: err.error ?? "unknown",
      message: err.message ?? "Something went wrong.",
      retryAfterSec: err.retryAfterSec,
      attemptsLeft: err.attemptsLeft,
    });
  }
  return json as T;
}

export const api = {
  sendCode: (channel: Channel, target: string, captchaToken?: string) =>
    call<{ target: string; expiresInSec: number }>(
      "POST",
      "/api/auth/otp/send",
      { channel, target, captchaToken },
      false,
    ),
  verifyCode: async (channel: Channel, target: string, code: string) => {
    const { session } = await call<{ session: SessionTokens }>(
      "POST",
      "/api/auth/otp/verify",
      { channel, target, code },
      false,
    );
    const { error } = await supabase.auth.setSession(session);
    if (error) throw new ApiFailure(400, { error: "session", message: error.message });
  },
  me: () => call<Me>("GET", "/api/me"),
  confirmAge: (dob: string) => call<{ ok: true }>("POST", "/api/onboarding/age", { dob }),
  acceptTerms: (tosVersion: string, privacyVersion: string) =>
    call<{ ok: true }>("POST", "/api/onboarding/terms", { tosVersion, privacyVersion }),
  checkHandle: (handle: string) =>
    call<{ available: boolean; handle?: string; message: string }>(
      "GET",
      `/api/handles/${encodeURIComponent(handle)}`,
    ),
  claimHandle: (handle: string) => call<{ handle: string }>("POST", "/api/onboarding/handle", { handle }),
  saveCharacter: (req: CharacterRequest) => call<{ ok: true }>("PUT", "/api/character", req),
  startLink: (channel: Channel, target: string) =>
    call<{ target: string; expiresInSec: number }>("POST", "/api/account/link/send", { channel, target }),
  finishLink: (channel: Channel, target: string, code: string) =>
    call<{ ok: true }>("POST", "/api/account/link/verify", { channel, target, code }),
};
