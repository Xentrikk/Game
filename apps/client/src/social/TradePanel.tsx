import {
  TRADE_MAX_ITEMS,
  getItemDefinition,
  type InventoryEntry,
  type ItemStack,
  type TradeState,
} from "@hearth/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Avatar, Panel } from "./bits";
import { useSocial, useSocialStore } from "./context";
import { ItemIcon } from "./ItemIcon";

interface Slot {
  itemId: string;
  quantity: number;
}
const emptySlots = (): Slot[] => Array.from({ length: TRADE_MAX_ITEMS }, () => ({ itemId: "", quantity: 1 }));

export function TradePanel({ tradeId, onClose }: { tradeId: string; onClose: () => void }) {
  const store = useSocialStore();
  const me = useSocial((s) => s.me);
  const [trade, setTrade] = useState<TradeState | null>(null);
  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [slots, setSlots] = useState<Slot[]>(emptySlots());
  const [coins, setCoins] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .trade(tradeId)
      .then(setTrade)
      .catch((e) => setError(describeError(e)));

  useEffect(() => {
    void load();
    void api.inventory().then((r) => setInventory(r.inventory));
    store.clearPendingTrade(tradeId);
    const off = store.stream.on((e) => {
      if (e.type === "trade_updated" && e.tradeId === tradeId) void load();
      if (e.type === "inventory_changed") void api.inventory().then((r) => setInventory(r.inventory));
      if (e.type === "wallet_changed") void store.refreshWallet();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeId]);

  if (!trade) {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="error" role="alert">
          {error}
        </p>
        {!error && <p className="hint">Loading…</p>}
      </Panel>
    );
  }

  const mine = trade.a.userId === me ? trade.a : trade.b;
  const theirs = trade.a.userId === me ? trade.b : trade.a;
  const attachable = inventory.filter((e) => getItemDefinition(e.itemId)?.tradeable);

  async function updateOffer() {
    setError("");
    setBusy(true);
    try {
      const items: ItemStack = slots
        .filter((s) => s.itemId)
        .map((s) => ({ itemId: s.itemId, quantity: s.quantity }));
      setTrade(await api.updateTradeOffer(tradeId, items, coins));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function setReady(ready: boolean) {
    setError("");
    setBusy(true);
    try {
      setTrade(await api.setTradeReady(tradeId, ready));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError("");
    setBusy(true);
    try {
      setTrade(await api.confirmTrade(tradeId));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setError("");
    setBusy(true);
    try {
      setTrade(await api.cancelTrade(tradeId));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (trade.status === "completed") {
    return (
      <Panel title="Trade complete!" onClose={onClose}>
        <p>You gave {mine.items.length || mine.coins ? "" : "nothing, and "}got:</p>
        <ul className="list">
          {theirs.coins > 0 && <li className="list-row">{theirs.coins} coins</li>}
          {theirs.items.map((i) => (
            <li key={i.itemId} className="list-row">
              <ItemIcon itemId={i.itemId} /> {getItemDefinition(i.itemId)?.name} ×{i.quantity}
            </li>
          ))}
        </ul>
        <button className="btn primary" onClick={onClose}>
          Nice!
        </button>
      </Panel>
    );
  }

  if (trade.status === "cancelled") {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p>This trade was cancelled.</p>
        <button className="btn primary" onClick={onClose}>
          OK
        </button>
      </Panel>
    );
  }

  const side = (label: string, s: TradeState["a"], showControls: boolean) => (
    <section className="trade-side">
      <p className="section-label">
        {label} {s.profile && <Avatar profile={s.profile} />} {s.ready ? "· Ready" : ""}
      </p>
      <ul className="list">
        {s.coins > 0 && <li className="list-row">{s.coins} coins</li>}
        {s.items.map((i) => (
          <li key={i.itemId} className="list-row">
            <ItemIcon itemId={i.itemId} size={20} /> {getItemDefinition(i.itemId)?.name} ×{i.quantity}
          </li>
        ))}
        {!s.items.length && !s.coins && <li className="hint">Nothing offered yet.</li>}
      </ul>
      {showControls && (
        <>
          {slots.map((slot, i) => (
            <div key={i} className="row nowrap">
              <select
                value={slot.itemId}
                disabled={busy}
                onChange={(e) =>
                  setSlots(slots.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))
                }
              >
                <option value="">(nothing)</option>
                {attachable.map((entry) => (
                  <option key={entry.id} value={entry.itemId}>
                    {getItemDefinition(entry.itemId)?.name} (have {entry.quantity})
                  </option>
                ))}
              </select>
              {slot.itemId && (
                <input
                  type="number"
                  min={1}
                  max={inventory.find((e) => e.itemId === slot.itemId)?.quantity ?? 1}
                  value={slot.quantity}
                  disabled={busy}
                  onChange={(e) =>
                    setSlots(slots.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))
                  }
                />
              )}
            </div>
          ))}
          <label className="field">
            <span>Coins</span>
            <input
              type="number"
              min={0}
              value={coins}
              disabled={busy}
              onChange={(e) => setCoins(Math.max(0, Number(e.target.value)))}
            />
          </label>
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void updateOffer()}>
              Update offer
            </button>
          </div>
        </>
      )}
    </section>
  );

  return (
    <Panel title="Trade" onClose={onClose}>
      <p className="error" role="alert">
        {error}
      </p>
      {side("You're offering", mine, true)}
      {side("They're offering", theirs, false)}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>
          Cancel trade
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void setReady(!mine.ready)}>
          {mine.ready ? "Not ready" : "Ready"}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !mine.ready || !theirs.ready}
          onClick={() => void confirm()}
        >
          Confirm
        </button>
      </div>
    </Panel>
  );
}
