import { PRIVACY_VERSION, TOS_VERSION, randomAppearance, type ServerEvent } from "@hearth/shared";
import { createClient } from "@supabase/supabase-js";
import type { AddressInfo } from "node:net";
import webpush from "web-push";
import { LocalBus } from "../../src/bus";
import { ChatRepo } from "../../src/chat/chatRepo";
import { connectDb } from "../../src/db";
import { PresenceService } from "../../src/social/presence";
import { PushService } from "../../src/social/push";
import { SocialRepo } from "../../src/social/socialRepo";
import { createApp } from "../../src/app";
import { supabaseTokenVerifier } from "../../src/auth";
import { noCaptcha } from "../../src/captcha";
import { GoTrueClient } from "../../src/gotrue";
import { OtpService } from "../../src/otp";
import { SupabaseRepo } from "../../src/repo";
import { MemoryStore } from "../../src/store";

// Defaults are the well-known keys of a local `supabase start` stack; they are not secrets.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** Phone numbers with a fixed OTP in supabase/config.toml ([auth.sms.test_otp]). */
export const TEST_PHONES = ["+15555550100", "+15555550101", "+15555550102", "+15555550103"];
export const TEST_CODE = "123456";

if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) {
  throw new Error("DB tests delete users and must only run against a local Supabase stack.");
}

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

export async function deleteTestUsers() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const testPhones = new Set(TEST_PHONES.map((p) => p.slice(1)));
  for (const u of data.users) {
    if ((u.phone && testPhones.has(u.phone)) || u.email?.endsWith("@hearth.test")) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Everything the social features need, with a fake push service that records what would be sent. */
export function makeSocial() {
  const sql = connectDb(DATABASE_URL);
  const store = new MemoryStore();
  const bus = new LocalBus();
  const social = new SocialRepo(sql);
  const chat = new ChatRepo(sql);
  const presence = new PresenceService(store, bus, social);
  const pushed: { endpoint: string; payload: { title: string; body: string; url: string; tag: string } }[] =
    [];
  const keys = webpush.generateVAPIDKeys();
  const push = new PushService(
    sql,
    social,
    presence,
    { ...keys, subject: "mailto:test@hearth.test" },
    async (sub, payload) => {
      pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return {};
    },
  );
  return { sql, store, bus, social, chat, presence, push, pushed, appUrl: "http://localhost:5173" };
}

export function makeLocalApp(social?: ReturnType<typeof makeSocial>) {
  const auth = new GoTrueClient(SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  return createApp({
    social,
    otp: new OtpService(new MemoryStore(), auth, noCaptcha, "http://localhost:5173/auth/callback"),
    auth,
    repo: new SupabaseRepo(SUPABASE_URL, SERVICE_KEY),
    verifyToken: supabaseTokenVerifier(SUPABASE_URL),
    corsOrigins: [],
    trustProxy: 0,
  });
}

/** A client acting as the signed-in user, to test RLS directly. */
export function userClient(accessToken: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** A signed-in, fully onboarded user (email under @hearth.test so cleanup finds it). */
export interface TestUser {
  id: string;
  handle: string;
  token: string;
  auth: { authorization: string };
}

export async function makeUser(api: string, handle: string): Promise<TestUser> {
  const email = `${handle}@hearth.test`;
  const password = "hearth-test-password";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const token = data.session!.access_token;
  const call = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  };
  await call("POST", "/api/onboarding/age", { dob: "2000-01-01" });
  await call("POST", "/api/onboarding/terms", { tosVersion: TOS_VERSION, privacyVersion: PRIVACY_VERSION });
  await call("POST", "/api/onboarding/handle", { handle });
  await call("PUT", "/api/character", {
    displayName: handle,
    pronouns: "",
    bio: "",
    appearance: randomAppearance(),
  });
  return { id: created.data.user!.id, handle, token, auth: { authorization: `Bearer ${token}` } };
}

/** Starts the app on a free port (needed to read the streaming /api/events endpoint). */
export async function listen(app: ReturnType<typeof createApp>) {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Opens a user's live event stream and collects events. */
export async function openEvents(api: string, token: string) {
  const controller = new AbortController();
  const res = await fetch(`${api}/api/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  const events: ServerEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (chunk.startsWith("data: ")) events.push(JSON.parse(chunk.slice(6)) as ServerEvent);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const waitFor = async <T extends ServerEvent>(pred: (e: ServerEvent) => e is T, ms = 3000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() > end)
        throw new Error(`event not received; got ${JSON.stringify(events.map((e) => e.type))}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  await waitFor((e): e is ServerEvent => e.type === "hello");
  return {
    events,
    waitFor,
    close: async () => {
      controller.abort();
      await pump;
    },
  };
}
