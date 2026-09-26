import { useEffect, useRef } from "react";
import { env } from "../env";

declare global {
  interface Window {
    turnstile?: {
      render(
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; theme?: string },
      ): string;
      remove(id: string): void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Cloudflare Turnstile widget. Renders nothing when no site key is configured (local dev and tests). */
export function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = env.turnstileSiteKey;

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let widgetId: string | undefined;
    const render = () => {
      if (ref.current && window.turnstile) {
        widgetId = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: onToken,
          theme: "dark",
        });
      }
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  return siteKey ? <div ref={ref} style={{ margin: "8px 0" }} /> : null;
}

export const captchaRequired = () => !!env.turnstileSiteKey;
