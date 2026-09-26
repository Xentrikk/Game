export interface CaptchaVerifier {
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export const noCaptcha: CaptchaVerifier = { verify: async () => true };

const ENDPOINTS = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  hcaptcha: "https://api.hcaptcha.com/siteverify",
};

export function remoteCaptcha(provider: keyof typeof ENDPOINTS, secret: string): CaptchaVerifier {
  return {
    async verify(token, ip) {
      if (!token) return false;
      const body = new URLSearchParams({ secret, response: token, remoteip: ip });
      const res = await fetch(ENDPOINTS[provider], { method: "POST", body });
      if (!res.ok) return false;
      const json = (await res.json()) as { success?: boolean };
      return json.success === true;
    },
  };
}
