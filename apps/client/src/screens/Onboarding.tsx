import {
  HANDLE_MAX,
  PRIVACY_VERSION,
  TOS_VERSION,
  validateHandle,
  HANDLE_PROBLEM_MESSAGES,
} from "@hearth/shared";
import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, api } from "../api";
import { describeError } from "../errors";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function AgeGate({ onDone, onBlocked }: { onDone: () => void; onBlocked: () => void }) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const thisYear = new Date().getFullYear();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!month || !day || !year) return setError("Choose your month, day and year.");
    setBusy(true);
    setError("");
    try {
      await api.confirmAge(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
      onDone();
    } catch (err) {
      if (err instanceof ApiFailure && err.body.error === "not_eligible") return onBlocked();
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <form className="window" onSubmit={submit} aria-labelledby="age-title">
        <h2 id="age-title">When's your birthday?</h2>
        <p className="hint">This keeps Hearth safe and follows the law. It's never shown to anyone.</p>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="visually-hidden">Date of birth</legend>
          <div className="dob">
            <label className="field">
              <span>Month</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)} autoComplete="bday-month">
                <option value="">—</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Day</span>
              <select value={day} onChange={(e) => setDay(e.target.value)} autoComplete="bday-day">
                <option value="">—</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={String(i + 1)}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Year</span>
              <select value={year} onChange={(e) => setYear(e.target.value)} autoComplete="bday-year">
                <option value="">—</option>
                {Array.from({ length: 100 }, (_, i) => (
                  <option key={i} value={String(thisYear - i)}>
                    {thisYear - i}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={busy}>
            Continue
          </button>
        </div>
      </form>
    </main>
  );
}

export function Terms({ onDone }: { onDone: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!agreed) return setError("Please agree to continue.");
    setBusy(true);
    try {
      await api.acceptTerms(TOS_VERSION, PRIVACY_VERSION);
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <form className="window" onSubmit={submit} aria-labelledby="terms-title">
        <h2 id="terms-title">A few ground rules</h2>
        <p>
          Hearth is for hanging out with friends. Be kind, keep private info private, and report anything that
          feels wrong.
        </p>
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the{" "}
            <a href="/legal/terms.html" target="_blank" rel="noreferrer">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/legal/privacy.html" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
            .
          </span>
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={busy}>
            Continue
          </button>
        </div>
      </form>
    </main>
  );
}

export function PickHandle({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    if (!value) return;
    const local = validateHandle(value);
    if (!local.ok) return setStatus({ ok: false, message: HANDLE_PROBLEM_MESSAGES[local.problem] });
    const t = setTimeout(() => {
      api
        .checkHandle(local.handle)
        .then((r) =>
          setStatus({ ok: r.available, message: r.available ? "That handle is free!" : r.message }),
        )
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [value]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const local = validateHandle(value);
    if (!local.ok) return setError(HANDLE_PROBLEM_MESSAGES[local.problem]);
    setBusy(true);
    try {
      await api.claimHandle(local.handle);
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <form className="window" onSubmit={submit} aria-labelledby="handle-title">
        <h2 id="handle-title">Pick your handle</h2>
        <p className="hint">
          Friends use this to find you. 3–16 letters, numbers or underscores. You can't change it later.
        </p>
        <label className="field">
          <span>Handle</span>
          <div className="prefix-input">
            <span aria-hidden="true">@</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.toLowerCase().replace(/\s/g, ""))}
              maxLength={HANDLE_MAX}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              autoFocus
              aria-describedby="handle-status"
            />
          </div>
        </label>
        <p id="handle-status" className={status?.ok ? "success" : "error"} role="status">
          {status?.message ?? ""}
        </p>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={busy || status?.ok === false}>
            Claim handle
          </button>
        </div>
      </form>
    </main>
  );
}

export function Blocked() {
  return (
    <main className="screen">
      <section className="window" aria-labelledby="blocked-title">
        <h2 id="blocked-title">Hearth</h2>
        <p>Sorry, you can't create a Hearth account right now.</p>
      </section>
    </main>
  );
}
