import { isE164, type Channel, type Me } from "@hearth/shared";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { supabase } from "../supabase";
import { COUNTRIES, guessCountry, toE164 } from "./countries";
import { EnterCode, describeError } from "./SignIn";

type View =
  | { name: "main" }
  | { name: "add"; channel: Channel }
  | { name: "code"; channel: Channel; target: string }
  | { name: "password" };

export function Account({ me, onBack, onChanged }: { me: Me; onBack: () => void; onChanged: () => void }) {
  const [view, setView] = useState<View>({ name: "main" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  if (view.name === "add") {
    return (
      <AddMethod
        channel={view.channel}
        onBack={() => setView({ name: "main" })}
        onSent={(target) => setView({ name: "code", channel: view.channel, target })}
      />
    );
  }
  if (view.name === "code") {
    return (
      <EnterCode
        title={view.channel === "phone" ? "Confirm your phone" : "Confirm your email"}
        channel={view.channel}
        target={view.target}
        onBack={() => setView({ name: "add", channel: view.channel })}
        verify={async (code) => {
          await api.finishLink(view.channel, view.target, code);
          setNotice(
            view.channel === "phone"
              ? "Phone added. You can sign in with it now."
              : "Email added. You can sign in with it now.",
          );
          setView({ name: "main" });
          onChanged();
        }}
        resend={() => api.startLink(view.channel, view.target).then(() => undefined)}
      />
    );
  }
  if (view.name === "password") {
    return (
      <SetPassword
        onDone={() => {
          setNotice("Password saved. You can use it with your email to sign in.");
          setView({ name: "main" });
        }}
        onBack={() => setView({ name: "main" })}
      />
    );
  }

  async function signOutOthers() {
    setError("");
    const { error: err } = await supabase.auth.signOut({ scope: "others" });
    if (err) setError(err.message);
    else setNotice("Signed out of all your other devices.");
  }

  return (
    <main className="screen">
      <section className="window" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <p className="hint">Only you can see these. Other players only see your handle.</p>
        <dl style={{ margin: "0 0 12px" }}>
          <dt className="section-label">Phone</dt>
          <dd style={{ margin: "0 0 8px" }} data-testid="account-phone">
            {me.phone ?? "Not added"}
          </dd>
          <dt className="section-label">Email</dt>
          <dd style={{ margin: 0 }} data-testid="account-email">
            {me.email ?? "Not added"}
          </dd>
        </dl>
        {notice && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        <p className="error" role="alert">
          {error}
        </p>
        <ul className="menu">
          {!me.phone && (
            <li>
              <button className="menu-item" onClick={() => setView({ name: "add", channel: "phone" })}>
                Add a phone number
              </button>
            </li>
          )}
          {!me.email && (
            <li>
              <button className="menu-item" onClick={() => setView({ name: "add", channel: "email" })}>
                Add an email
              </button>
            </li>
          )}
          {me.email && (
            <li>
              <button className="menu-item" onClick={() => setView({ name: "password" })}>
                Set a password
              </button>
            </li>
          )}
          <li>
            <button className="menu-item" onClick={signOutOthers}>
              Sign out other devices
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={() => void supabase.auth.signOut({ scope: "local" })}>
              Sign out
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={onBack}>
              Back
            </button>
          </li>
        </ul>
      </section>
    </main>
  );
}

function AddMethod({
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const target = channel === "phone" ? toE164(country, value) : value.trim();
    if (channel === "phone" && !isE164(target))
      return setError("That doesn't look like a full phone number.");
    setBusy(true);
    try {
      const res = await api.startLink(channel, target);
      onSent(res.target);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <form className="window" onSubmit={submit} aria-labelledby="add-title">
        <h2 id="add-title">{channel === "phone" ? "Add a phone number" : "Add an email"}</h2>
        {channel === "phone" && (
          <label className="field">
            <span>Country</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map(([iso, name, dial]) => (
                <option key={iso} value={iso}>
                  {name} (+{dial})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{channel === "phone" ? "Phone number" : "Email"}</span>
          <input
            type={channel === "phone" ? "tel" : "email"}
            autoComplete={channel === "phone" ? "tel-national" : "email"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Send code
          </button>
        </div>
      </form>
    </main>
  );
}

function SetPassword({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Those passwords don't match.");
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) return setError(err.message);
    onDone();
  }

  return (
    <main className="screen">
      <form className="window" onSubmit={submit} aria-labelledby="pw-title">
        <h2 id="pw-title">Set a password</h2>
        <p className="hint">Optional. You can always sign in with a code instead.</p>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Type it again</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
          <button type="submit" className="btn primary">
            Save password
          </button>
        </div>
      </form>
    </main>
  );
}
