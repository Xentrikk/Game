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

/** The composited character sprite as a data URL, once it has finished drawing. */
export async function spritePixels(page: Page, name: string | RegExp): Promise<string> {
  const canvas = page.getByRole("img", { name });
  await expect(canvas).toHaveAttribute("data-ready", "true");
  return canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
}
