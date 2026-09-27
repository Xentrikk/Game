import {
  HANDLE_PROBLEM_MESSAGES,
  PRIVACY_VERSION,
  TOS_VERSION,
  ageSchema,
  characterSchema,
  checkAge,
  handleSchema,
  linkSendSchema,
  linkVerifySchema,
  otpSendSchema,
  otpVerifySchema,
  termsSchema,
  todayUtc,
  validateHandle,
  type Me,
} from "@hearth/shared";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { currentUser, requireUser, type TokenVerifier } from "./auth";
import { HttpError, NOT_ELIGIBLE_MESSAGE } from "./errors";
import { parse } from "./http";
import type { AuthApi } from "./gotrue";
import type { OtpService } from "./otp";
import { chatRoutes } from "./chat/routes";
import { economyRoutes, type EconomyDeps } from "./economy/routes";
import { eventRoutes } from "./events";
import { HandleTakenError, type Repo } from "./repo";
import { socialRoutes, type SocialDeps } from "./social/routes";

export interface AppDeps {
  otp: OtpService;
  auth: AuthApi;
  repo: Repo;
  verifyToken: TokenVerifier;
  corsOrigins: string[];
  trustProxy: number;
  /** Injectable clock for age-gate tests. */
  today?: () => string;
  /** Friends, chat and live events (Phase 3). Optional so account-only tests can run without a database. */
  social?: Omit<SocialDeps, "verifyToken">;
  /** Homes, inventory, coins, letters and trading (Phase 4). Optional, same reason as `social`. */
  economy?: Omit<EconomyDeps, "verifyToken">;
}

export function createApp(deps: AppDeps) {
  const { otp, auth, repo } = deps;
  const today = deps.today ?? (() => todayUtc());
  const app = express();
  app.set("trust proxy", deps.trustProxy);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigins, credentials: false }));
  app.use(express.json({ limit: "16kb" }));

  const ip = (req: Request) => req.ip ?? "unknown";
  const authed = requireUser(deps.verifyToken);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ---- Sign in (unauthenticated) ----

  app.post("/api/auth/otp/send", async (req, res) => {
    const body = parse(otpSendSchema, req.body);
    const result = await otp.send(body.channel, body.target, body.captchaToken, ip(req));
    res.json(result);
  });

  app.post("/api/auth/otp/verify", async (req, res) => {
    const body = parse(otpVerifySchema, req.body);
    const session = await otp.verify(body.channel, body.target, body.code, ip(req));
    res.json({ session });
  });

  // ---- Account (authenticated) ----

  app.get("/api/me", authed, async (req, res) => {
    const user = currentUser(req);
    const [authUser, personal, profile, appearance] = await Promise.all([
      auth.getUser(user.id),
      repo.getPersonal(user.id),
      repo.getProfile(user.id),
      repo.getAppearance(user.id),
    ]);
    if (personal?.ageBlockedAt) throw new HttpError(403, "not_eligible", NOT_ELIGIBLE_MESSAGE);
    const me: Me = {
      userId: user.id,
      phone: authUser.phone,
      email: authUser.email,
      onboarding: {
        ageVerified: !!personal?.ageVerifiedAt,
        termsAccepted: !!personal?.termsAcceptedAt,
        handle: profile?.handle ?? null,
        hasCharacter: !!appearance,
      },
      profile,
      appearance,
    };
    res.json(me);
  });

  app.post("/api/account/link/send", authed, async (req, res) => {
    const user = currentUser(req);
    const body = parse(linkSendSchema, req.body);
    res.json(await otp.startLink(user.id, user.jwt, body.channel, body.target, ip(req)));
  });

  app.post("/api/account/link/verify", authed, async (req, res) => {
    const user = currentUser(req);
    const body = parse(linkVerifySchema, req.body);
    await otp.finishLink(user.id, user.jwt, body.channel, body.target, body.code, ip(req));
    res.json({ ok: true });
  });

  // ---- Onboarding (authenticated, in order: age → terms → handle → character) ----

  app.post("/api/onboarding/age", authed, async (req, res) => {
    const user = currentUser(req);
    const { dob } = parse(ageSchema, req.body);
    const personal = await repo.getPersonal(user.id);
    if (personal?.ageBlockedAt) throw new HttpError(403, "not_eligible", NOT_ELIGIBLE_MESSAGE);
    if (personal?.ageVerifiedAt) return void res.json({ ok: true });

    const check = checkAge(dob, today());
    if (!check.ok && check.reason === "invalid") {
      throw new HttpError(400, "invalid_date", "Enter a real date of birth.");
    }
    if (!check.ok) {
      // Record only that the gate failed (never the DOB), then block the account from signing in again.
      await repo.markAgeBlocked(user.id);
      await auth.ban(user.id);
      throw new HttpError(403, "not_eligible", NOT_ELIGIBLE_MESSAGE);
    }
    await repo.markAgeVerified(user.id, dob);
    res.json({ ok: true });
  });

  app.post("/api/onboarding/terms", authed, async (req, res) => {
    const user = currentUser(req);
    const body = parse(termsSchema, req.body);
    if (body.tosVersion !== TOS_VERSION || body.privacyVersion !== PRIVACY_VERSION) {
      throw new HttpError(409, "terms_outdated", "The terms have changed. Please review them again.");
    }
    const personal = await repo.getPersonal(user.id);
    if (!personal?.ageVerifiedAt)
      throw new HttpError(409, "out_of_order", "Confirm your date of birth first.");
    await repo.acceptTerms(user.id, body.tosVersion, body.privacyVersion);
    res.json({ ok: true });
  });

  app.get("/api/handles/:handle", authed, async (req, res) => {
    const check = validateHandle(String(req.params.handle));
    if (!check.ok)
      return void res.json({ available: false, message: HANDLE_PROBLEM_MESSAGES[check.problem] });
    const taken = await repo.handleTaken(check.handle);
    res.json({
      available: !taken,
      handle: check.handle,
      message: taken ? HANDLE_PROBLEM_MESSAGES.taken : "",
    });
  });

  app.post("/api/onboarding/handle", authed, async (req, res) => {
    const user = currentUser(req);
    const body = parse(handleSchema, req.body);
    const check = validateHandle(body.handle);
    if (!check.ok) throw new HttpError(400, "invalid_handle", HANDLE_PROBLEM_MESSAGES[check.problem]);
    const personal = await repo.getPersonal(user.id);
    if (!personal?.ageVerifiedAt || !personal.termsAcceptedAt) {
      throw new HttpError(409, "out_of_order", "Finish the earlier sign-up steps first.");
    }
    if (await repo.getProfile(user.id))
      throw new HttpError(409, "handle_already_set", "You already have a handle.");
    try {
      await repo.createProfile(user.id, check.handle);
    } catch (e) {
      if (e instanceof HandleTakenError)
        throw new HttpError(409, "handle_taken", HANDLE_PROBLEM_MESSAGES.taken);
      throw e;
    }
    res.json({ handle: check.handle });
  });

  app.put("/api/character", authed, async (req, res) => {
    const user = currentUser(req);
    const body = parse(characterSchema, req.body);
    if (!(await repo.getProfile(user.id))) throw new HttpError(409, "out_of_order", "Pick a handle first.");
    await repo.saveCharacter(
      user.id,
      { displayName: body.displayName, pronouns: body.pronouns, bio: body.bio },
      body.appearance,
    );
    res.json({ ok: true });
  });

  if (deps.social) {
    const social = { ...deps.social, verifyToken: deps.verifyToken };
    app.use(socialRoutes(social));
    app.use(chatRoutes(social));
    app.use(eventRoutes(social));
  }
  if (deps.economy) {
    app.use(economyRoutes({ ...deps.economy, verifyToken: deps.verifyToken }));
  }

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "not_found", "Not found.")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      if (err.extra.retryAfterSec) res.setHeader("Retry-After", String(err.extra.retryAfterSec));
      return void res.status(err.status).json(err.toJSON());
    }
    if (err instanceof SyntaxError) {
      return void res.status(400).json({ error: "invalid_json", message: "Invalid JSON." });
    }
    console.error(err);
    res.status(500).json({ error: "internal", message: "Something went wrong." });
  });

  return app;
}
