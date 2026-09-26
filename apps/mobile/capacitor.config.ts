import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Wraps the web client (apps/client/dist) as the iOS and Android apps.
 * Build the client with VITE_API_URL set to the public API origin, since the app can't use the dev proxy.
 */
const config: CapacitorConfig = {
  appId: "app.hearth.game",
  appName: "Hearth",
  webDir: "../client/dist",
  backgroundColor: "#1b1f3a",
  ios: { contentInset: "always" },
  android: { allowMixedContent: false },
};

export default config;
