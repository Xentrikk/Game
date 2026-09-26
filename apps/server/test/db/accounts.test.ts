import { PRIVACY_VERSION, TOS_VERSION, defaultAppearance, randomAppearance } from "@hearth/shared";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { TEST_CODE, TEST_PHONES, admin, deleteTestUsers, makeLocalApp, userClient } from "./local";

const app = makeLocalApp();
const terms = { tosVersion: TOS_VERSION, privacyVersion: PRIVACY_VERSION };

async function signIn(phone: string) {
  const sent = await request(app).post("/api/auth/otp/send").send({ channel: "phone", target: phone });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const res = await request(app)
    .post("/api/auth/otp/verify")
    .send({ channel: "phone", target: phone, code: TEST_CODE });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const token = res.body.session.access_token as string;
  return { token, auth: { authorization: `Bearer ${token}` } };
}

async function onboard(phone: string, handle: string) {
  const u = await signIn(phone);
  expect(
    (await request(app).post("/api/onboarding/age").set(u.auth).send({ dob: "2000-05-05" })).status,
  ).toBe(200);
  expect((await request(app).post("/api/onboarding/terms").set(u.auth).send(terms)).status).toBe(200);
  expect((await request(app).post("/api/onboarding/handle").set(u.auth).send({ handle })).status).toBe(200);
  const character = { displayName: handle, pronouns: "", bio: "", appearance: randomAppearance() };
  expect((await request(app).put("/api/character").set(u.auth).send(character)).status).toBe(200);
  return { ...u, character };
}

beforeAll(async () => {
  await deleteTestUsers();
});

describe("real Supabase: sign-in and onboarding", () => {
  it("signs up by phone, onboards, and reads it all back", async () => {
    const u = await onboard(TEST_PHONES[0]!, "dbtest_one");
    const me = (await request(app).get("/api/me").set(u.auth)).body;
    expect(me.phone).toBe(TEST_PHONES[0]);
    expect(me.onboarding).toEqual({
      ageVerified: true,
      termsAccepted: true,
      handle: "dbtest_one",
      hasCharacter: true,
    });
    expect(me.appearance).toEqual(u.character.appearance);
  });

  it("enforces case-insensitive handle uniqueness in the database", async () => {
    const u = await signIn(TEST_PHONES[1]!);
    await request(app).post("/api/onboarding/age").set(u.auth).send({ dob: "2000-05-05" });
    await request(app).post("/api/onboarding/terms").set(u.auth).send(terms);
    const res = await request(app).post("/api/onboarding/handle").set(u.auth).send({ handle: "DBTEST_ONE" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("handle_taken");
  });

  it("blocks an under-age user, stores no DOB, and refuses their next sign-in", async () => {
    const u = await signIn(TEST_PHONES[2]!);
    const res = await request(app).post("/api/onboarding/age").set(u.auth).send({ dob: "2020-01-01" });
    expect(res.status).toBe(403);
    expect((await request(app).get("/api/me").set(u.auth)).status).toBe(403);
    const users = await admin.auth.admin.listUsers();
    const blocked = users.data.users.find((x) => x.phone === TEST_PHONES[2]!.slice(1))!;
    const row = await admin
      .from("personal_data")
      .select("dob, age_blocked_at")
      .eq("user_id", blocked.id)
      .single();
    expect(row.data?.dob).toBeNull();
    expect(row.data?.age_blocked_at).not.toBeNull();

    await request(app).post("/api/auth/otp/send").send({ channel: "phone", target: TEST_PHONES[2] });
    const again = await request(app)
      .post("/api/auth/otp/verify")
      .send({ channel: "phone", target: TEST_PHONES[2], code: TEST_CODE });
    expect(again.status).toBe(403);
    expect(again.body.error).toBe("not_eligible");
  });

  it("links an email to a phone account, then signs in with the email", async () => {
    const u = await signIn(TEST_PHONES[3]!);
    const email = "linker@hearth.test";
    const s = await request(app)
      .post("/api/account/link/send")
      .set(u.auth)
      .send({ channel: "email", target: email });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    const code = await latestEmailCode(email);
    const v = await request(app)
      .post("/api/account/link/verify")
      .set(u.auth)
      .send({ channel: "email", target: email, code });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const me = (await request(app).get("/api/me").set(u.auth)).body;
    expect(me.email).toBe(email);

    await request(app).post("/api/auth/otp/send").send({ channel: "email", target: email });
    const code2 = await latestEmailCode(email, code);
    const signin = await request(app)
      .post("/api/auth/otp/verify")
      .send({ channel: "email", target: email, code: code2 });
    expect(signin.status, JSON.stringify(signin.body)).toBe(200);
    const me2 = (
      await request(app)
        .get("/api/me")
        .set({ authorization: `Bearer ${signin.body.session.access_token}` })
    ).body;
    expect(me2.userId).toBe(me.userId);
    expect(me2.phone).toBe(TEST_PHONES[3]);
  });
});

describe("real Supabase: row level security", () => {
  it("lets users read only their own rows and write none directly", async () => {
    // Reuse the account from the first test.
    await request(app).post("/api/auth/otp/send").send({ channel: "phone", target: TEST_PHONES[0] });
    const a = await request(app)
      .post("/api/auth/otp/verify")
      .send({ channel: "phone", target: TEST_PHONES[0], code: TEST_CODE });
    const db = userClient(a.body.session.access_token);

    const own = await db.from("profiles").select("handle");
    expect(own.data).toEqual([{ handle: "dbtest_one" }]);
    const allPersonal = await db.from("personal_data").select("user_id");
    expect(allPersonal.data).toHaveLength(1);

    const upd = await db.from("profiles").update({ handle: "hacked" }).eq("handle", "dbtest_one").select();
    expect(upd.error ?? upd.data?.length === 0).toBeTruthy();
    const ins = await db
      .from("appearances")
      .upsert({ user_id: "00000000-0000-0000-0000-000000000000", data: { v: 1 } });
    expect(ins.error).not.toBeNull();
    const rpc = await db.rpc("save_character", {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_display_name: "x",
      p_pronouns: "",
      p_bio: "",
      p_appearance: defaultAppearance(),
    });
    expect(rpc.error).not.toBeNull();

    const anon = await userClient("not-a-token").from("profiles").select("handle");
    expect(anon.data ?? []).toEqual([]);
  });

  it("refuses to create a profile before the age gate, even with the service role", async () => {
    const { data: created } = await admin.auth.admin.createUser({
      email: "noage@hearth.test",
      email_confirm: true,
    });
    const res = await admin.from("profiles").insert({ user_id: created.user!.id, handle: "noage_user" });
    expect(res.error?.message).toMatch(/age gate/);
  });
});

/** Reads the 6-digit code from the most recent email to `to` in the local Mailpit inbox. */
async function latestEmailCode(to: string, notEqual?: string): Promise<string> {
  const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  for (let i = 0; i < 40; i++) {
    const list = (await (
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    ).json()) as {
      messages: { ID: string }[];
    };
    const id = list.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as {
        Text: string;
        HTML: string;
      };
      const code = /\b(\d{6})\b/.exec(msg.Text || msg.HTML)?.[1];
      if (code && code !== notEqual) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email code arrived for ${to}`);
}
