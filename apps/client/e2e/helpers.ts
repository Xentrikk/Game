import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

// Well-known keys of a local `supabase start` stack (not secrets).
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/**
 * Test numbers from supabase/config.toml [auth.sms.test_otp]; they always accept 123456.
 * Each browser project gets its own, so per-number rate limits don't collide.
 */
const PHONES: Record<string, { main: string; underage: string }> = {
  mobile: { main: "5555550110", underage: "5555550111" },
  desktop: { main: "5555550112", underage: "5555550113" },
};
export const phonesFor = (project: string) => PHONES[project] ?? PHONES.desktop!;
export const TEST_CODE = "123456";

/** Supabase refuses a second code to the same number/email within a few seconds (auth.sms.max_frequency). */
export const waitBeforeResend = () => new Promise((r) => setTimeout(r, 5500));

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

export async function deleteE2eUsers() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const phones = new Set(Object.values(PHONES).flatMap((p) => [`1${p.main}`, `1${p.underage}`]));
  for (const u of data.users) {
    if ((u.phone && phones.has(u.phone)) || u.email?.endsWith("@e2e.hearth.test")) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

async function latestEmail(to: string, notId?: string) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = (await res.json()) as { messages: { ID: string }[] };
    const id = list.messages[0]?.ID;
    if (id && id !== notId) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Text: string;
        HTML: string;
      };
      return { id, text: msg.Text, html: msg.HTML };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email arrived for ${to}`);
}

export async function emailCode(to: string, notId?: string) {
  const mail = await latestEmail(to, notId);
  const code = /\b(\d{6})\b/.exec(mail.text || mail.html)?.[1];
  if (!code) throw new Error("No code in email");
  return { code, id: mail.id };
}

export async function emailLink(to: string, notId?: string) {
  const mail = await latestEmail(to, notId);
  const href = /href="([^"]+)"/.exec(mail.html)?.[1];
  if (!href) throw new Error("No link in email");
  return { link: href.replace(/&amp;/g, "&"), id: mail.id };
}

export async function lastEmailId(to: string): Promise<string | undefined> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const list = (await res.json()) as { messages: { ID: string }[] };
  return list.messages[0]?.ID;
}

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
/** API of the e2e server started by playwright.config.ts. */
export const E2E_API = process.env.E2E_API ?? "http://localhost:2568";

export interface TestPlayer {
  email: string;
  password: string;
  handle: string;
  token: string;
}

/**
 * Creates a fully onboarded player (age, terms, handle, character) through the real API, so world
 * tests don't have to click through sign-up. Email is under @e2e.hearth.test so cleanup finds it.
 */
export async function createPlayer(handle: string, appearance?: unknown): Promise<TestPlayer> {
  const email = `${handle}@e2e.hearth.test`;
  const password = "hearth-e2e-password";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const token = data.session!.access_token;
  const call = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`${E2E_API}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  };
  const { defaultAppearance, TOS_VERSION, PRIVACY_VERSION } = await import("@hearth/shared");
  await call("POST", "/api/onboarding/age", { dob: "2000-01-01" });
  await call("POST", "/api/onboarding/terms", { tosVersion: TOS_VERSION, privacyVersion: PRIVACY_VERSION });
  await call("POST", "/api/onboarding/handle", { handle });
  await call("PUT", "/api/character", {
    displayName: handle,
    pronouns: "",
    bio: "",
    appearance: appearance ?? defaultAppearance(),
  });
  return { email, password, handle, token };
}

/** Signs in through the UI with email + password. */
export async function signInWithPassword(page: Page, player: TestPlayer) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByRole("button", { name: "Use my password instead" }).click();
  await page.getByLabel("Email", { exact: true }).fill(player.email);
  await page.getByLabel("Password", { exact: true }).fill(player.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(`@${player.handle}`)).toBeVisible();
}

/** The composited character sprite as a data URL, once it has finished drawing. */
export async function spritePixels(page: Page, name: string | RegExp): Promise<string> {
  const canvas = page.getByRole("img", { name });
  await expect(canvas).toHaveAttribute("data-ready", "true");
  return canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
}
