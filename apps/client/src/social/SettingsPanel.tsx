import type { PublicProfile, Settings } from "@hearth/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Avatar, Panel } from "./bits";
import { enablePush, pushStatus, type PushStatus } from "./push";

const PUSH_TEXT: Record<PushStatus, string> = {
  on: "Notifications are on for this device.",
  off: "Notifications are off for this device.",
  blocked: "Notifications are blocked in your browser settings for this site.",
  unsupported: "This browser can't show notifications.",
  unavailable: "Notifications aren't set up on this server yet.",
};

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [blocked, setBlocked] = useState<PublicProfile[]>([]);
  const [push, setPush] = useState<PushStatus>("off");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    void Promise.all([api.settings(), api.blocked(), pushStatus()])
      .then(([s, b, p]) => {
        setSettings(s);
        setBlocked(b.blocked);
        setPush(p);
      })
      .catch((e) => setError(describeError(e)));
  }, []);

  async function save(patch: Record<string, unknown>) {
    setError("");
    setSaved("");
    try {
      setSettings(await api.updateSettings(patch));
      setSaved("Saved.");
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (!settings) {
    return (
      <Panel title="Settings" onClose={onClose}>
        <p className="hint">{error || "Loading…"}</p>
      </Panel>
    );
  }

  const toggle = (
    label: string,
    checked: boolean,
    patch: (v: boolean) => Record<string, unknown>,
    hint?: string,
  ) => (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => void save(patch(e.target.checked))} />
      <span>
        {label}
        {hint && <span className="hint block">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Panel title="Settings" onClose={onClose}>
      <p className="section-label">Privacy</p>
      {toggle(
        "Read receipts",
        settings.readReceipts,
        (v) => ({ readReceipts: v }),
        "Off: friends won't see when you've read their messages, and you won't see theirs.",
      )}
      {toggle("Show friends where I am", settings.shareLocation, (v) => ({ shareLocation: v }))}
      <label className="field">
        <span>Status</span>
        <select value={settings.presence} onChange={(e) => void save({ presence: e.target.value })}>
          <option value="auto">Online (automatic)</option>
          <option value="dnd">Do not disturb</option>
          <option value="invisible">Appear offline</option>
        </select>
      </label>

      <p className="section-label">Notifications</p>
      <p className="hint">{PUSH_TEXT[push]}</p>
      {push === "off" && (
        <button
          type="button"
          className="btn"
          onClick={() =>
            void enablePush()
              .then(setPush)
              .catch((e) => setError(describeError(e)))
          }
        >
          Turn on notifications
        </button>
      )}
      {toggle("Messages from friends", settings.notifications.dm, (v) => ({ notifications: { dm: v } }))}
      {toggle("Group chats", settings.notifications.group, (v) => ({ notifications: { group: v } }))}
      {toggle("Friend requests", settings.notifications.friendRequest, (v) => ({
        notifications: { friendRequest: v },
      }))}
      {toggle("Quiet hours", settings.quietHours.enabled, (v) => ({
        quietHours: { enabled: v },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }))}
      {settings.quietHours.enabled && (
        <div className="row">
          <label className="field">
            <span>From</span>
            <input
              type="time"
              value={settings.quietHours.start}
              onChange={(e) => void save({ quietHours: { start: e.target.value } })}
            />
          </label>
          <label className="field">
            <span>Until</span>
            <input
              type="time"
              value={settings.quietHours.end}
              onChange={(e) => void save({ quietHours: { end: e.target.value } })}
            />
          </label>
        </div>
      )}

      <p className="section-label">Blocked</p>
      <ul className="list">
        {!blocked.length && <li className="hint">You haven't blocked anyone.</li>}
        {blocked.map((p) => (
          <li key={p.id} className="list-row">
            <span className="row-main">
              <Avatar profile={p} /> {p.displayName}
            </span>
            <button
              type="button"
              className="chip"
              onClick={() =>
                void api
                  .unblock(p.id)
                  .then(() => setBlocked((b) => b.filter((x) => x.id !== p.id)))
                  .catch((e) => setError(describeError(e)))
              }
            >
              Unblock
            </button>
          </li>
        ))}
      </ul>
      {saved && (
        <p className="success" role="status">
          {saved}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
    </Panel>
  );
}
