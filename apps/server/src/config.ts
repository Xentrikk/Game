import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(2567),
  /** Public URL of the web client, used for magic-link redirects. */
  APP_URL: z.string().url().default("http://localhost:5173"),
  /** Comma-separated list of origins allowed to call the API (e.g. the Capacitor app). */
  CORS_ORIGINS: z.string().default("http://localhost:5173,capacitor://localhost,http://localhost"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Leave empty to use an in-memory store (single instance only, e.g. tests). */
  REDIS_URL: z.string().optional(),
  CAPTCHA_PROVIDER: z.enum(["none", "turnstile", "hcaptcha"]).default("none"),
  CAPTCHA_SECRET: z.string().optional(),
  /** Number of reverse proxies in front of the server, for correct client IPs. */
  TRUST_PROXY: z.coerce.number().default(0),
  /** Per-IP limits on top of the per-number/email limits. Raise only for load or e2e testing. */
  OTP_IP_SENDS_PER_HOUR: z.coerce.number().int().positive().default(10),
  OTP_IP_VERIFIES_PER_5_MIN: z.coerce.number().int().positive().default(30),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid server environment:\n  ${issues}`);
  }
  if (parsed.data.CAPTCHA_PROVIDER !== "none" && !parsed.data.CAPTCHA_SECRET) {
    throw new Error("CAPTCHA_SECRET is required when CAPTCHA_PROVIDER is set");
  }
  return parsed.data;
}
