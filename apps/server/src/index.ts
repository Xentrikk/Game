import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { TOWN_ROOM } from "@hearth/shared";
import { Redis } from "ioredis";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { noCaptcha, remoteCaptcha } from "./captcha";
import { loadConfig } from "./config";
import { GoTrueClient } from "./gotrue";
import { OtpService } from "./otp";
import { SupabaseRepo } from "./repo";
import { TownRoom } from "./rooms/TownRoom";
import { MemoryStore, RedisStore } from "./store";

const config = loadConfig();

const store = config.REDIS_URL ? new RedisStore(new Redis(config.REDIS_URL)) : new MemoryStore();
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
});

TownRoom.deps = { repo, verifyToken };

// One HTTP server for the REST API and the Colyseus game server (matchmaking + WebSockets).
const server = new Server({
  transport: new WebSocketTransport(),
  express: (app) => {
    app.use(api);
  },
});
server.define(TOWN_ROOM, TownRoom);

await server.listen(config.PORT);
console.log(`Hearth server listening on http://localhost:${config.PORT}`);
