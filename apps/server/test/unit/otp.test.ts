import request from "supertest";
import { describe, expect, it } from "vitest";
import { GOOD_CODE, makeTestApp } from "./fakes";

const PHONE = "+15555550100";

async function send(app: ReturnType<typeof makeTestApp>["app"], target = PHONE, channel = "phone") {
  return request(app).post("/api/auth/otp/send").send({ channel, target });
}
async function verify(
  app: ReturnType<typeof makeTestApp>["app"],
  code: string,
  target = PHONE,
  channel = "phone",
) {
  return request(app).post("/api/auth/otp/verify").send({ channel, target, code });
}

describe("OTP sending", () => {
  it("sends a code and normalizes the phone number", async () => {
    const { app, auth } = makeTestApp();
    const res = await send(app, "+1 (555) 555-0100");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ target: PHONE, expiresInSec: 600 });
    expect(auth.sent).toEqual([{ channel: "phone", target: PHONE }]);
  });

  it("rejects numbers that aren't E.164", async () => {
    const { app } = makeTestApp();
    const res = await send(app, "5555550100");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_phone");
  });

  it("allows 3 sends per number per hour, then blocks with Retry-After", async () => {
    const { app, auth, clock } = makeTestApp();
    for (let i = 0; i < 3; i++) expect((await send(app)).status).toBe(200);
    const blocked = await send(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(auth.sent).toHaveLength(3);

    clock.advance(3601);
    expect((await send(app)).status).toBe(200);
  });

  it("limits each address separately (email is limited too)", async () => {
    const { app } = makeTestApp();
    for (let i = 0; i < 3; i++) await send(app);
    expect((await send(app, "+15555550101")).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await send(app, "Sam@Example.com", "email")).status).toBe(200);
    expect((await send(app, "sam@example.com", "email")).status).toBe(429);
  });

  it("limits sends per IP across many numbers", async () => {
    const { app } = makeTestApp();
    for (let i = 0; i < 10; i++) expect((await send(app, `+1555555${String(1000 + i)}`)).status).toBe(200);
    expect((await send(app, "+15555552000")).status).toBe(429);
  });

  it("requires a passing captcha when one is configured", async () => {
    const { app, auth } = makeTestApp({ captcha: { verify: async (t) => t === "ok" } });
    const bad = await request(app).post("/api/auth/otp/send").send({ channel: "phone", target: PHONE });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("captcha_failed");
    const good = await request(app)
      .post("/api/auth/otp/send")
      .send({ channel: "phone", target: PHONE, captchaToken: "ok" });
    expect(good.status).toBe(200);
    expect(auth.sent).toHaveLength(1);
  });
});

describe("OTP verification", () => {
  it("returns a session for the right code, and the code can't be reused", async () => {
    const { app } = makeTestApp();
    await send(app);
    const res = await verify(app, GOOD_CODE);
    expect(res.status).toBe(200);
    expect(res.body.session.access_token).toMatch(/^token:/);
    expect((await verify(app, GOOD_CODE)).status).toBe(410);
  });

  it("allows 5 attempts per code, then requires a new code", async () => {
    const { app } = makeTestApp();
    await send(app);
    for (let left = 4; left >= 1; left--) {
      const res = await verify(app, "000000");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_code", attemptsLeft: left });
    }
    const fifth = await verify(app, "000000");
    expect(fifth.status).toBe(429);
    // Even the right code is refused once attempts are used up.
    const sixth = await verify(app, GOOD_CODE);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe("too_many_attempts");
    // A new code resets attempts.
    await send(app);
    expect((await verify(app, GOOD_CODE)).status).toBe(200);
  });

  it("expires codes after 10 minutes", async () => {
    const { app, clock } = makeTestApp();
    await send(app);
    clock.advance(601);
    const res = await verify(app, GOOD_CODE);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("code_expired");
  });

  it("refuses verification when no code was sent", async () => {
    const { app } = makeTestApp();
    expect((await verify(app, GOOD_CODE)).status).toBe(410);
  });

  it("rejects malformed codes before counting an attempt", async () => {
    const { app } = makeTestApp();
    await send(app);
    expect((await verify(app, "12ab")).status).toBe(400);
    expect((await verify(app, GOOD_CODE)).status).toBe(200);
  });
});

describe("linking a second sign-in method", () => {
  it("links an email to a phone account", async () => {
    const { app, auth } = makeTestApp();
    await send(app);
    const token = (await verify(app, GOOD_CODE)).body.session.access_token;
    const bearer = { authorization: `Bearer ${token}` };
    const s = await request(app)
      .post("/api/account/link/send")
      .set(bearer)
      .send({ channel: "email", target: "sam@example.com" });
    expect(s.status).toBe(200);
    const bad = await request(app)
      .post("/api/account/link/verify")
      .set(bearer)
      .send({ channel: "email", target: "sam@example.com", code: "000000" });
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .post("/api/account/link/verify")
      .set(bearer)
      .send({ channel: "email", target: "sam@example.com", code: GOOD_CODE });
    expect(ok.status).toBe(200);
    expect(auth.users.get(token.slice(6))?.email).toBe("sam@example.com");
  });

  it("refuses a target that belongs to another account", async () => {
    const { app } = makeTestApp();
    await send(app, "+15555550101");
    await verify(app, GOOD_CODE, "+15555550101");
    await send(app);
    const token = (await verify(app, GOOD_CODE)).body.session.access_token;
    const res = await request(app)
      .post("/api/account/link/send")
      .set({ authorization: `Bearer ${token}` })
      .send({ channel: "phone", target: "+15555550101" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_used");
  });

  it("requires sign-in", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post("/api/account/link/send")
      .send({ channel: "email", target: "a@b.co" });
    expect(res.status).toBe(401);
  });
});
