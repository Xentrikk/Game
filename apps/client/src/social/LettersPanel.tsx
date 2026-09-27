import {
  DEFAULT_STATIONERY_ID,
  LETTER_BODY_MAX,
  LETTER_SUBJECT_MAX,
  getItemDefinition,
  type InventoryEntry,
  type ItemStack,
  type Letter,
} from "@hearth/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Avatar, Panel } from "./bits";
import { useSocial, useSocialStore } from "./context";
import { ItemIcon } from "./ItemIcon";

type Tab = "inbox" | "sent" | "compose";
const ATTACH_SLOTS = 3;

export function LettersPanel({
  onClose,
  onOpenProfile,
}: {
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
}) {
  const store = useSocialStore();
  const [tab, setTab] = useState<Tab>("inbox");
  const [inbox, setInbox] = useState<Letter[] | null>(null);
  const [sent, setSent] = useState<Letter[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadInbox = () =>
    api
      .letters()
      .then((r) => setInbox(r.letters))
      .catch((e) => setError(describeError(e)));
  const loadSent = () =>
    api
      .sentLetters()
      .then((r) => setSent(r.letters))
      .catch((e) => setError(describeError(e)));

  useEffect(() => {
    void loadInbox();
    void store.refreshMailboxFlag();
    const off = store.stream.on((e) => {
      if (e.type === "letter") void Promise.all([loadInbox(), store.refreshMailboxFlag()]);
      if (e.type === "wallet_changed") void store.refreshWallet();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "sent" && !sent) void loadSent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function claim(id: string) {
    setBusy(id);
    setError("");
    try {
      await api.claimLetter(id);
      await Promise.all([loadInbox(), store.refreshWallet(), store.refreshMailboxFlag()]);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Letters" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Letters">
        {(["inbox", "sent", "compose"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "inbox" ? "Inbox" : t === "sent" ? "Sent" : "Write"}
          </button>
        ))}
      </div>
      <p className="error" role="alert">
        {error}
      </p>

      {tab === "inbox" && (
        <ul className="list">
          {!inbox && <li className="hint">Loading…</li>}
          {inbox && !inbox.length && <li className="hint">Nothing in your mailbox yet.</li>}
          {inbox?.map((l) => (
            <li key={l.id} className="list-row letter-row">
              <button
                type="button"
                className="row-main"
                onClick={() => l.fromProfile && onOpenProfile(l.fromProfile.handle)}
              >
                {l.fromProfile && <Avatar profile={l.fromProfile} />}
                <span>
                  {l.subject || "(no subject)"}
                  <span className="hint block">
                    From {l.fromProfile?.displayName ?? "someone who's left"}
                    {!l.readAt && " · New"}
                  </span>
                  <span className="hint block">{l.body}</span>
                  {(l.items.length > 0 || l.coins > 0) && (
                    <span className="row" style={{ marginTop: 4 }}>
                      {l.coins > 0 && <span className="badge">{l.coins} coins</span>}
                      {l.items.map((i) => (
                        <span key={i.itemId} className="badge">
                          <ItemIcon itemId={i.itemId} size={16} /> {getItemDefinition(i.itemId)?.name} ×
                          {i.quantity}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
              {!l.claimedAt && (l.items.length > 0 || l.coins > 0) && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => void claim(l.id)}
                  disabled={busy === l.id}
                >
                  Claim
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "sent" && (
        <ul className="list">
          {!sent && <li className="hint">Loading…</li>}
          {sent && !sent.length && <li className="hint">You haven't sent any letters.</li>}
          {sent?.map((l) => (
            <li key={l.id} className="list-row">
              <span className="row-main">
                <span>
                  {l.subject || "(no subject)"}
                  <span className="hint block">
                    To {l.toUserId} · {l.claimedAt ? "Claimed" : l.readAt ? "Read" : "Sent"}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === "compose" && <ComposeLetter onSent={() => setTab("sent")} />}
    </Panel>
  );
}

function ComposeLetter({ onSent }: { onSent: () => void }) {
  const friends = useSocial((s) => s.friends);
  const [toUserId, setToUserId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [stationeryId, setStationeryId] = useState(DEFAULT_STATIONERY_ID);
  const [coins, setCoins] = useState(0);
  const [attach, setAttach] = useState<{ itemId: string; quantity: number }[]>(
    Array.from({ length: ATTACH_SLOTS }, () => ({ itemId: "", quantity: 1 })),
  );
  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void api.inventory().then((r) => setInventory(r.inventory));
  }, []);

  const stationeryOptions = [
    DEFAULT_STATIONERY_ID,
    ...inventory
      .map((e) => e.itemId)
      .filter((id) => getItemDefinition(id)?.category === "stationery" && id !== DEFAULT_STATIONERY_ID),
  ];
  const attachable = inventory.filter((e) => getItemDefinition(e.itemId)?.tradeable);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!toUserId) return setError("Pick a friend to send it to.");
    if (!body.trim()) return setError("Write something first.");
    setSending(true);
    try {
      const items: ItemStack = attach
        .filter((a) => a.itemId)
        .map((a) => ({ itemId: a.itemId, quantity: a.quantity }));
      await api.sendLetter({ toUserId, subject, body, stationeryId, items, coins });
      setSent(true);
      setTimeout(onSent, 900);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }

  if (sent) return <p className="success">Letter sent!</p>;

  return (
    <form className="compose-letter" onSubmit={submit}>
      <label className="field">
        <span>To</span>
        <select value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
          <option value="">Choose a friend…</option>
          {friends?.friends.map((f) => (
            <option key={f.profile.id} value={f.profile.id}>
              {f.profile.displayName} (@{f.profile.handle})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Stationery</span>
        <select value={stationeryId} onChange={(e) => setStationeryId(e.target.value)}>
          {stationeryOptions.map((id) => (
            <option key={id} value={id}>
              {getItemDefinition(id)?.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Subject (optional)</span>
        <input value={subject} maxLength={LETTER_SUBJECT_MAX} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field">
        <span>Message</span>
        <textarea
          rows={4}
          maxLength={LETTER_BODY_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Coins to send</span>
        <input
          type="number"
          min={0}
          value={coins}
          onChange={(e) => setCoins(Math.max(0, Number(e.target.value)))}
        />
      </label>
      <p className="section-label">Attach items</p>
      {attach.map((a, i) => (
        <div key={i} className="row nowrap">
          <select
            value={a.itemId}
            onChange={(e) =>
              setAttach(attach.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))
            }
          >
            <option value="">(nothing)</option>
            {attachable.map((entry) => (
              <option key={entry.id} value={entry.itemId}>
                {getItemDefinition(entry.itemId)?.name} (have {entry.quantity})
              </option>
            ))}
          </select>
          {a.itemId && (
            <input
              type="number"
              min={1}
              max={inventory.find((e) => e.itemId === a.itemId)?.quantity ?? 1}
              value={a.quantity}
              onChange={(e) =>
                setAttach(attach.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))
              }
            />
          )}
        </div>
      ))}
      <p className="error" role="alert">
        {error}
      </p>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={sending}>
          Send letter
        </button>
      </div>
    </form>
  );
}
