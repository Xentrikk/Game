import { createClient } from "@supabase/supabase-js";
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

export function makeLocalApp() {
  const auth = new GoTrueClient(SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  return createApp({
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
