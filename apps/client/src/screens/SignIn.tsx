import { isE164, type Channel } from "@hearth/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure, api } from "../api";
import { Captcha, captchaRequired } from "../components/Captcha";
import { DialogueBox } from "../components/DialogueBox";
import { supabase } from "../supabase";
import { COUNTRIES, guessCountry, toE164 } from "./countries";

type Step =
  | { name: "welcome" }
  | { name: "enter"; channel: Channel }
  | { name: "code"; channel: Channel; target: string };

export function SignIn() {
  const [step, setStep] = useState<Step>({ name: "welcome" });

  if (step.name === "welcome") {
    return (
      <main className="screen">
        <section className="window" aria-labelledby="welcome-title">
          <h1 id="welcome-title">Hearth</h1>
          <DialogueBox text="Welcome! Hearth is a little world where your friends live. Let's get you set up." />
          <ul className="menu">
            <li>
              <button
                className="menu-item"
                onClick={() => setStep({ name: "enter", channel: "phone" })}
                autoFocus
              >
                Continue with phone
              </button>
            </li>
            <li>
              <button className="menu-item" onClick={() => setStep({ name: "enter", channel: "email" })}>
                Continue with email
              </button>
            </li>
          </ul>
        </section>
      </main>
    );
  }
  if (step.name === "enter") {
    return (
      <EnterTarget
        channel={step.channel}
        onBack={() => setStep({ name: "welcome" })}
        onSent={(target) => setStep({ name: "code", channel: step.channel, target })}
      />
    );
  }
  return (
    <EnterCode
      channel={step.channel}
      target={step.target}
      onBack={() => setStep({ name: "enter", channel: step.channel })}
      verify={(code) => api.verifyCode(step.channel, step.target, code)}
      resend={() => api.sendCode(step.channel, step.target).then(() => undefined)}
    />
  );
}

export function describeError(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.body.retryAfterSec && e.status === 429) {
      const s = e.body.retryAfterSec;
      if (s < 60) return `${e.message} (about ${s} second${s === 1 ? "" : "s"})`;
      const mins = Math.ceil(s / 60);
      return `${e.message} (about ${mins} min${mins === 1 ? "" : "s"})`;
    }
    if (e.body.attemptsLeft !== undefined && e.body.attemptsLeft > 0) {
      return `${e.message} ${e.body.attemptsLeft} ${e.body.attemptsLeft === 1 ? "try" : "tries"} left.`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

function EnterTarget({
  channel,
  onBack,
  onSent,
}: {
  channel: Channel;
  onBack: () => void;
  onSent: (target: string) => void;
}) {
  const [country, setCountry] = useState(guessCountry);
  const [value, setValue] = useState("");
  const [captcha, setCaptcha] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const onToken = useCallback((t: string) => setCaptcha(t), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    let target = value.trim();
    if (channel === "phone") {
      target = toE164(country, value);
      if (!isE164(target)) return setError("That doesn't look like a full phone number.");
    }
    if (captchaRequired() && !captcha && !usePassword) return setError("Please complete the security check.");
    setBusy(true);
    try {
      if (usePassword) {
        const { error: err } = await supabase.auth.signInWithPassword({ email: target, password });
        if (err) throw new Error("That email and password don't match.");
      } else {
        const res = await api.sendCode(channel, target, captcha);
        onSent(res.target);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <form className="window" onSubmit={submit} aria-labelledby="enter-title" noValidate>
        <h2 id="enter-title">{channel === "phone" ? "Your phone number" : "Your email"}</h2>
        {channel === "phone" ? (
          <>
            <label className="field">
              <span>Country</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)} autoComplete="country">
                {COUNTRIES.map(([iso, name, dial]) => (
                  <option key={iso} value={iso}>
                    {name} (+{dial})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Phone number</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="555 555 0100"
                autoFocus
                required
              />
            </label>
            <p className="hint">
              We'll text you a 6-digit code. Your number is never shown to other players.
            </p>
          </>
        ) : (
          <>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
            </label>
            {usePassword ? (
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
            ) : (
              <p className="hint">
                We'll email you a sign-in link and a 6-digit code. Your email is never shown to other players.
              </p>
            )}
          </>
        )}
        {!usePassword && <Captcha onToken={onToken} />}
        <p className="error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {usePassword ? "Sign in" : busy ? "Sending…" : "Send code"}
          </button>
        </div>
        {channel === "email" && (
          <button type="button" className="btn" onClick={() => setUsePassword((v) => !v)}>
            {usePassword ? "Use a code instead" : "Use my password instead"}
          </button>
        )}
      </form>
    </main>
  );
}

const RESEND_COOLDOWN_SEC = 30;

export function EnterCode({
  channel,
  target,
  onBack,
  verify,
  resend,
  title,
}: {
  channel: Channel;
  target: string;
  onBack: () => void;
  verify: (code: string) => Promise<void>;
  resend: () => Promise<void>;
  title?: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SEC);
  const [notice, setNotice] = useState("");
  const submitted = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(value = code) {
    if (!/^\d{6}$/.test(value)) return setError("Enter the 6-digit code.");
    setBusy(true);
    setError("");
    try {
      await verify(value);
    } catch (err) {
      setError(describeError(err));
      setCode("");
      submitted.current = false;
    } finally {
      setBusy(false);
    }
  }

  async function doResend() {
    setError("");
    setNotice("");
    try {
      await resend();
      setCooldown(RESEND_COOLDOWN_SEC);
      setNotice("New code sent.");
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <main className="screen">
      <form
        className="window"
        aria-labelledby="code-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="code-title">{title ?? "Enter your code"}</h2>
        <p>
          {channel === "phone" ? "We texted a code to " : "We emailed a code to "}
          <strong>{target}</strong>.{channel === "email" && " You can also just tap the link in that email."}
        </p>
        <label className="field">
          <span>6-digit code</span>
          <input
            className="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6 && !submitted.current) {
                submitted.current = true;
                void submit(v);
              }
            }}
            autoFocus
            aria-describedby="code-help"
          />
        </label>
        <p id="code-help" className="hint">
          The code works for 10 minutes.
        </p>
        <p className="error" role="alert">
          {error}
        </p>
        {notice && <p className="success">{notice}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onBack}>
            {channel === "phone" ? "Change number" : "Change email"}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </div>
        <button type="button" className="btn" onClick={doResend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
        </button>
      </form>
    </main>
  );
}
