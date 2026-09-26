import { formatFriendCode, normalizeFriendCode, type PublicProfile } from "@hearth/shared";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Avatar, Panel, PresenceDot, presenceLabel } from "./bits";
import { useSocial, useSocialStore } from "./context";

type Tab = "friends" | "requests" | "add";

interface Props {
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
  onOpenChat: (conversationId: string) => void;
  /** In the world: join a friend's Town Square instance. */
  onGoTo?: (roomId: string) => void;
  initialTab?: Tab;
}

export function FriendsPanel({ onClose, onOpenProfile, onOpenChat, onGoTo, initialTab = "friends" }: Props) {
  const store = useSocialStore();
  const data = useSocial((s) => s.friends);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [error, setError] = useState("");

  useEffect(() => {
    void store.refreshFriends().catch((e) => setError(describeError(e)));
  }, [store]);

  const incoming = data?.incoming.length ?? 0;
  const run = (fn: () => Promise<unknown>) => async () => {
    setError("");
    try {
      await fn();
      await store.refreshFriends();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <Panel title="Friends" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Friends">
        {(["friends", "requests", "add"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "friends"
              ? "Friends"
              : t === "requests"
                ? `Requests${incoming ? ` (${incoming})` : ""}`
                : "Add"}
          </button>
        ))}
      </div>
      <p className="error" role="alert">
        {error}
      </p>

      {tab === "friends" && (
        <ul className="list">
          {!data && <li className="hint">Loading…</li>}
          {data && !data.friends.length && (
            <li className="hint">
              No friends yet. Use the Add tab to share your code or find someone by handle.
            </li>
          )}
          {data?.friends.map((f) => (
            <li key={f.profile.id} className="list-row">
              <button type="button" className="row-main" onClick={() => onOpenProfile(f.profile.handle)}>
                <Avatar profile={f.profile} />
                <span>
                  {f.profile.displayName}
                  <span className="hint block">
                    <PresenceDot presence={f.presence} /> {presenceLabel(f.presence)}
                  </span>
                </span>
              </button>
              {onGoTo && f.presence.location && (
                <button type="button" className="chip" onClick={() => onGoTo(f.presence.location!.roomId)}>
                  Go
                </button>
              )}
              <button
                type="button"
                className="chip"
                onClick={run(async () => {
                  const c = await api.openDm(f.profile.id);
                  await store.refreshConversations();
                  onOpenChat(c.id);
                })}
              >
                Message
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "requests" && (
        <>
          <p className="section-label">Asking to be your friend</p>
          <ul className="list">
            {!data?.incoming.length && <li className="hint">No requests right now.</li>}
            {data?.incoming.map((r) => (
              <li key={r.id} className="list-row">
                <button type="button" className="row-main" onClick={() => onOpenProfile(r.profile.handle)}>
                  <Avatar profile={r.profile} />
                  <span>
                    {r.profile.displayName} <span className="hint block">@{r.profile.handle}</span>
                  </span>
                </button>
                <button type="button" className="chip" onClick={run(() => api.acceptRequest(r.id))}>
                  Accept
                </button>
                <button type="button" className="chip" onClick={run(() => api.removeRequest(r.id))}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
          <p className="section-label">You asked</p>
          <ul className="list">
            {!data?.outgoing.length && <li className="hint">Nothing waiting.</li>}
            {data?.outgoing.map((r) => (
              <li key={r.id} className="list-row">
                <span className="row-main">
                  <Avatar profile={r.profile} />
                  <span>
                    {r.profile.displayName} <span className="hint block">@{r.profile.handle}</span>
                  </span>
                </span>
                <button type="button" className="chip" onClick={run(() => api.removeRequest(r.id))}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "add" && <AddFriend onOpenProfile={onOpenProfile} />}
    </Panel>
  );
}

function AddFriend({ onOpenProfile }: { onOpenProfile: (handle: string) => void }) {
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [mine, setMine] = useState<{ code: string; inviteUrl: string; qr: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const show = async (res: { code: string; inviteUrl: string }) => {
    const qr = await QRCode.toDataURL(res.inviteUrl, {
      margin: 1,
      scale: 4,
      color: { dark: "#1a1420", light: "#f4f4f0" },
    });
    setMine({ ...res, qr });
  };
  useEffect(() => {
    void api
      .friendCode()
      .then(show)
      .catch((e) => setError(describeError(e)));
  }, []);

  async function findHandle(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { profile } = await api.lookupHandle(handle.replace(/^@/, ""));
      onOpenProfile(profile.handle);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function useCode(e: FormEvent) {
    e.preventDefault();
    setError("");
    const normalized = normalizeFriendCode(code);
    if (!normalized) return setError("Friend codes are 8 letters and numbers, like ABCD-2345.");
    try {
      const { profile } = await api.lookupCode(normalized);
      onOpenProfile((profile as PublicProfile).handle);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function copy() {
    if (!mine) return;
    try {
      await navigator.clipboard.writeText(mine.inviteUrl);
      setNotice("Invite link copied.");
    } catch {
      setNotice(mine.inviteUrl);
    }
  }

  return (
    <div className="add-friend">
      <form onSubmit={findHandle}>
        <label className="field">
          <span>Find someone by handle</span>
          <div className="row nowrap">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle"
              autoCapitalize="none"
            />
            <button type="submit" className="chip">
              Find
            </button>
          </div>
        </label>
      </form>
      <form onSubmit={useCode}>
        <label className="field">
          <span>Have a friend code?</span>
          <div className="row nowrap">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCD-2345"
              autoCapitalize="characters"
            />
            <button type="submit" className="chip">
              Add
            </button>
          </div>
        </label>
      </form>
      <p className="error" role="alert">
        {error}
      </p>
      {mine && (
        <section aria-label="Your friend code" className="my-code">
          <p className="section-label">Your friend code</p>
          <p className="code-big">{formatFriendCode(mine.code)}</p>
          <img
            src={mine.qr}
            alt={`QR code for your invite link, ${mine.inviteUrl}`}
            width={132}
            height={132}
            className="qr"
          />
          <p className="hint">
            Friends can scan this with their phone camera, or you can send them the link.
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={copy}>
              Copy invite link
            </button>
            <button type="button" className="btn" onClick={() => void api.regenerateFriendCode().then(show)}>
              New code
            </button>
          </div>
          {notice && <p className="success">{notice}</p>}
        </section>
      )}
    </div>
  );
}
