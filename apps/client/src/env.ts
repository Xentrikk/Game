/** Client configuration from Vite env vars (see .env.example at the repo root). */
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  /** Empty means same origin (the Vite dev proxy or a reverse proxy forwards /api). */
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? "",
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
};
