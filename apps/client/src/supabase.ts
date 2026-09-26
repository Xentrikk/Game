import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

if (!env.supabaseUrl || !env.supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.");
}

/**
 * Sessions come from our server's OTP endpoints (setSession) or from magic links, which land on
 * /auth/callback with tokens in the URL fragment, so we use the implicit flow.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
