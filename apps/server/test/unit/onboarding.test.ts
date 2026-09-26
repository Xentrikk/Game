import { PRIVACY_VERSION, TOS_VERSION, defaultAppearance } from "@hearth/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { GOOD_CODE, makeTestApp } from "./fakes";

async function signIn(t: ReturnType<typeof makeTestApp>, phone = "+15555550100") {
  await request(t.app).post("/api/auth/otp/send").send({ channel: "phone", target: phone });
  const res = await request(t.app)
    .post("/api/auth/otp/verify")
    .send({ channel: "phone", target: phone, code: GOOD_CODE });
  const token = res.body.session.access_token as string;
  return { token, userId: token.slice(6), auth: { authorization: `Bearer ${token}` } };
}

const terms = { tosVersion: TOS_VERSION, privacyVersion: PRIVACY_VERSION };
const character = { displayName: "Sam", pronouns: "they/them", bio: "hi", appearance: defaultAppearance() };

describe("age gate", () => {
  it("accepts users who are old enough and stores their DOB", async () => {
    const t = makeTestApp();
    const u = await signIn(t);
    const res = await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2013-09-26" });
    expect(res.status).toBe(200);
    expect(t.repo.personal.get(u.userId)?.dob).toBe("2013-09-26");
  });

  it("blocks under-13s with a neutral message, stores no DOB and bans the account", async () => {
    const t = makeTestApp();
    const u = await signIn(t);
    const res = await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2013-09-27" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_eligible");
    expect(res.body.message).not.toMatch(/age|13|old|young/i);
    expect(t.repo.personal.get(u.userId)).toMatchObject({ dob: null, ageVerifiedAt: null });
    expect(t.auth.banned.has(u.userId)).toBe(true);

    // Trying again with an older date doesn't work.
    const retry = await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2000-01-01" });
    expect(retry.status).toBe(403);
    // Signing in again is refused with the same neutral message.
    await request(t.app).post("/api/auth/otp/send").send({ channel: "phone", target: "+15555550100" });
    const again = await request(t.app)
      .post("/api/auth/otp/verify")
      .send({ channel: "phone", target: "+15555550100", code: GOOD_CODE });
    expect(again.status).toBe(403);
    expect(again.body.error).toBe("not_eligible");
  });

  it("rejects invalid dates without blocking", async () => {
    const t = makeTestApp();
    const u = await signIn(t);
    const res = await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2030-01-01" });
    expect(res.status).toBe(400);
    expect(t.auth.banned.size).toBe(0);
  });
});

describe("onboarding order", () => {
  it("won't accept terms, handle or character out of order", async () => {
    const t = makeTestApp();
    const u = await signIn(t);
    expect((await request(t.app).post("/api/onboarding/terms").set(u.auth).send(terms)).status).toBe(409);
    expect(
      (await request(t.app).post("/api/onboarding/handle").set(u.auth).send({ handle: "sam" })).status,
    ).toBe(409);
    expect((await request(t.app).put("/api/character").set(u.auth).send(character)).status).toBe(409);
  });

  it("rejects outdated terms versions", async () => {
    const t = makeTestApp();
    const u = await signIn(t);
    await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2000-01-01" });
    const res = await request(t.app)
      .post("/api/onboarding/terms")
      .set(u.auth)
      .send({ ...terms, tosVersion: "old" });
    expect(res.status).toBe(409);
  });

  it("walks the full flow and reports it in /api/me", async () => {
    const t = makeTestApp();
    const u = await signIn(t);
    let me = (await request(t.app).get("/api/me").set(u.auth)).body;
    expect(me.onboarding).toEqual({
      ageVerified: false,
      termsAccepted: false,
      handle: null,
      hasCharacter: false,
    });

    await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2000-01-01" });
    await request(t.app).post("/api/onboarding/terms").set(u.auth).send(terms);
    const h = await request(t.app).post("/api/onboarding/handle").set(u.auth).send({ handle: "Pixel_Sam" });
    expect(h.body).toEqual({ handle: "pixel_sam" });
    const c = await request(t.app).put("/api/character").set(u.auth).send(character);
    expect(c.status).toBe(200);

    me = (await request(t.app).get("/api/me").set(u.auth)).body;
    expect(me.onboarding).toEqual({
      ageVerified: true,
      termsAccepted: true,
      handle: "pixel_sam",
      hasCharacter: true,
    });
    expect(me.profile).toEqual({ handle: "pixel_sam", displayName: "Sam", pronouns: "they/them", bio: "hi" });
    expect(me.appearance).toEqual(character.appearance);
    expect(me.phone).toBe("+15555550100");
  });
});

describe("handles", () => {
  async function ready(t: ReturnType<typeof makeTestApp>, phone: string) {
    const u = await signIn(t, phone);
    await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2000-01-01" });
    await request(t.app).post("/api/onboarding/terms").set(u.auth).send(terms);
    return u;
  }

  it("enforces case-insensitive uniqueness", async () => {
    const t = makeTestApp();
    const a = await ready(t, "+15555550100");
    const b = await ready(t, "+15555550101");
    expect(
      (await request(t.app).post("/api/onboarding/handle").set(a.auth).send({ handle: "sam" })).status,
    ).toBe(200);
    const taken = await request(t.app).post("/api/onboarding/handle").set(b.auth).send({ handle: "SAM" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("handle_taken");
    const avail = await request(t.app).get("/api/handles/Sam").set(b.auth);
    expect(avail.body.available).toBe(false);
  });

  it("rejects reserved and inappropriate handles", async () => {
    const t = makeTestApp();
    const u = await ready(t, "+15555550100");
    for (const handle of ["admin", "hearth_help", "sh1tty", "no spaces"]) {
      const res = await request(t.app).post("/api/onboarding/handle").set(u.auth).send({ handle });
      expect(res.status, handle).toBe(400);
    }
  });

  it("can only be set once", async () => {
    const t = makeTestApp();
    const u = await ready(t, "+15555550100");
    await request(t.app).post("/api/onboarding/handle").set(u.auth).send({ handle: "sam" });
    const again = await request(t.app).post("/api/onboarding/handle").set(u.auth).send({ handle: "sam2" });
    expect(again.status).toBe(409);
  });
});

describe("character", () => {
  it("rejects appearances with unknown option IDs or bad profile text", async () => {
    const t = makeTestApp();
    const u = await signIn(t);
    await request(t.app).post("/api/onboarding/age").set(u.auth).send({ dob: "2000-01-01" });
    await request(t.app).post("/api/onboarding/terms").set(u.auth).send(terms);
    await request(t.app).post("/api/onboarding/handle").set(u.auth).send({ handle: "sam" });

    const badHair = {
      ...character,
      appearance: { ...character.appearance, hair: { style: "rainbow", color: 0 } },
    };
    expect((await request(t.app).put("/api/character").set(u.auth).send(badHair)).status).toBe(400);
    const badBio = { ...character, bio: "you are an ass" };
    expect((await request(t.app).put("/api/character").set(u.auth).send(badBio)).status).toBe(400);
    const extra = { ...character, appearance: { ...character.appearance, isAdmin: true } };
    expect((await request(t.app).put("/api/character").set(u.auth).send(extra)).status).toBe(400);
    expect((await request(t.app).put("/api/character").set(u.auth).send(character)).status).toBe(200);
  });

  it("rejects unauthenticated and forged tokens", async () => {
    const t = makeTestApp();
    expect((await request(t.app).get("/api/me")).status).toBe(401);
    expect((await request(t.app).get("/api/me").set({ authorization: "Bearer forged" })).status).toBe(401);
  });
});
