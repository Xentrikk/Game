import type { Channel, SessionTokens } from "@hearth/shared";

/**
 * Thin client for the Supabase Auth (GoTrue) REST API. We call it directly so the server can put its
 * own rate limits and attempt counting in front of OTP sending and verification.
 */
export interface AuthApi {
  sendOtp(channel: Channel, target: string, redirectTo: string): Promise<void>;
  verifyOtp(channel: Channel, target: string, code: string): Promise<SessionTokens>;
  /** Starts adding a phone/email to an existing account; sends a code to the new target. */
  startLink(userJwt: string, channel: Channel, target: string): Promise<void>;
  finishLink(userJwt: string, channel: Channel, target: string, code: string): Promise<void>;
  getUser(userId: string): Promise<{ id: string; phone: string | null; email: string | null }>;
  ban(userId: string): Promise<void>;
}

export class AuthApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class GoTrueClient implements AuthApi {
  constructor(
    private url: string,
    private anonKey: string,
    private serviceKey: string,
  ) {}

  private async call<T>(
    path: string,
    init: { method: string; body?: unknown; bearer?: string; admin?: boolean },
  ) {
    const key = init.admin ? this.serviceKey : this.anonKey;
    const res = await fetch(`${this.url}/auth/v1${path}`, {
      method: init.method,
      headers: {
        apikey: key,
        authorization: `Bearer ${init.bearer ?? key}`,
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const code = String(json.error_code ?? json.code ?? json.error ?? "auth_error");
      const message = String(json.msg ?? json.message ?? json.error_description ?? "Auth request failed");
      throw new AuthApiError(res.status, code, message);
    }
    return json as T;
  }

  async sendOtp(channel: Channel, target: string, redirectTo: string) {
    const q = channel === "email" ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    await this.call(`/otp${q}`, { method: "POST", body: { [channel]: target, create_user: true } });
  }

  async verifyOtp(channel: Channel, target: string, code: string) {
    const type = channel === "phone" ? "sms" : "email";
    return this.call<SessionTokens>("/verify", {
      method: "POST",
      body: { type, [channel]: target, token: code },
    });
  }

  async startLink(userJwt: string, channel: Channel, target: string) {
    await this.call("/user", { method: "PUT", bearer: userJwt, body: { [channel]: target } });
  }

  async finishLink(userJwt: string, channel: Channel, target: string, code: string) {
    const type = channel === "phone" ? "phone_change" : "email_change";
    await this.call("/verify", {
      method: "POST",
      bearer: userJwt,
      body: { type, [channel]: target, token: code },
    });
  }

  async getUser(userId: string) {
    const u = await this.call<{ id: string; phone?: string; email?: string }>(`/admin/users/${userId}`, {
      method: "GET",
      admin: true,
    });
    return { id: u.id, phone: u.phone ? `+${u.phone.replace(/^\+/, "")}` : null, email: u.email || null };
  }

  async ban(userId: string) {
    // ~100 years. Supabase has no permanent ban; this is the documented way to block an account.
    await this.call(`/admin/users/${userId}`, {
      method: "PUT",
      admin: true,
      body: { ban_duration: "876000h" },
    });
  }
}
