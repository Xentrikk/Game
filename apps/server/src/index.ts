import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HOME_ROOM, TOWN_ROOM } from "@hearth/shared";
import { Redis } from "ioredis";
import { createApp } from "./app";
import { LocalBus, RedisBus } from "./bus";
import { ChatRepo } from "./chat/chatRepo";
import { connectDb } from "./db";
import { EconomyRepo } from "./economy/economyRepo";
import { HomeRepo } from "./economy/homeRepo";
import { LetterRepo } from "./economy/letterRepo";
import { TradeRepo } from "./economy/tradeRepo";
import { PresenceService } from "./social/presence";
import { PushService } from "./social/push";
import { SocialRepo } from "./social/socialRepo";
import { supabaseTokenVerifier } from "./auth";
import { noCaptcha, remoteCaptcha } from "./captcha";
import { loadConfig } from "./config";
import { GoTrueClient } from "./gotrue";
import { OtpService } from "./otp";
import { SupabaseRepo } from "./repo";
import { HomeRoom } from "./rooms/HomeRoom";
import { TownRoom } from "./rooms/TownRoom";
import { MemoryStore, RedisStore } from "./store";

const config = loadConfig();

const store = config.REDIS_URL ? new RedisStore(new Redis(config.REDIS_URL)) : new MemoryStore();
const bus = config.REDIS_URL
  ? new RedisBus(new Redis(config.REDIS_URL), new Redis(config.REDIS_URL))
  : new LocalBus();
const sql = connectDb(config.DATABASE_URL);
const social = new SocialRepo(sql);
const chat = new ChatRepo(sql);
const economy = new EconomyRepo(sql);
const homes = new HomeRepo(sql);
const letters = new LetterRepo(sql);
const trades = new TradeRepo(sql);
const presence = new PresenceService(store, bus, social);
const vapid =
  config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
    ? {
        publicKey: config.VAPID_PUBLIC_KEY,
        privateKey: config.VAPID_PRIVATE_KEY,
        subject: config.VAPID_SUBJECT,
      }
    : null;
if (!vapid) console.warn("VAPID keys not set: push notifications are off.");
const push = new PushService(sql, social, presence, vapid);
if (!config.REDIS_URL) console.warn("REDIS_URL not set: using in-memory rate limits (single instance only).");

const captcha =
  config.CAPTCHA_PROVIDER === "none"
    ? noCaptcha
    : remoteCaptcha(config.CAPTCHA_PROVIDER, config.CAPTCHA_SECRET!);
const auth = new GoTrueClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY,
  config.SUPABASE_SERVICE_ROLE_KEY,
);
const repo = new SupabaseRepo(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const verifyToken = supabaseTokenVerifier(config.SUPABASE_URL);

const api = createApp({
  otp: new OtpService(store, auth, captcha, `${config.APP_URL}/auth/callback`, Date.now, {
    sendsPerHour: config.OTP_IP_SENDS_PER_HOUR,
    verifiesPer5Min: config.OTP_IP_VERIFIES_PER_5_MIN,
  }),
  auth,
  repo,
  verifyToken,
  corsOrigins: config.CORS_ORIGINS.split(",").map((s) => s.trim()),
  trustProxy: config.TRUST_PROXY,
  social: { social, chat, presence, push, bus, store, appUrl: config.APP_URL },
  economy: { economy, homes, letters, trades, social, presence, push, bus },
});

const worldSocial = {
  blockedEitherWay: (id: string) => social.blockedEitherWay(id),
  muted: (id: string) => social.muted(id),
  createReport: (r: Parameters<typeof social.createReport>[0]) => social.createReport(r),
  setLocation: (id: string, loc: Parameters<typeof presence.setLocation>[1]) => presence.setLocation(id, loc),
  bus,
};

TownRoom.deps = { repo, verifyToken, social: worldSocial };
HomeRoom.deps = {
  repo,
  verifyToken,
  social: worldSocial,
  homes,
  social2: social,
};

// One HTTP server for the REST API and the Colyseus game server (matchmaking + WebSockets).
const server = new Server({
  transport: new WebSocketTransport(),
  express: (app) => {
    app.use(api);
  },
});
server.define(TOWN_ROOM, TownRoom);
// One room instance per home: every visitor to the same home lands in the same instance.
server.define(HOME_ROOM, HomeRoom).filterBy(["ownerId"]);

await server.listen(config.PORT);
console.log(`Hearth server listening on http://localhost:${config.PORT}`);
