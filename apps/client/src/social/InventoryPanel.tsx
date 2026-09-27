import { ITEM_CATEGORIES, getItemDefinition, type InventoryEntry } from "@hearth/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Panel } from "./bits";
import { useSocial, useSocialStore } from "./context";
import { ItemIcon } from "./ItemIcon";

const CATEGORY_LABELS: Record<(typeof ITEM_CATEGORIES)[number], string> = {
  cosmetics: "Cosmetics",
  furniture: "Furniture",
  collectibles: "Collectibles",
  consumables: "Consumables",
  stationery: "Stationery",
};

export function InventoryPanel({ onClose }: { onClose: () => void }) {
  const store = useSocialStore();
  const wallet = useSocial((s) => s.wallet);
  const [inventory, setInventory] = useState<InventoryEntry[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      setInventory((await api.inventory()).inventory);
    } catch (e) {
      setError(describeError(e));
    }
  };

  useEffect(() => {
    void load();
    void store.refreshWallet();
    const off = store.stream.on((e) => {
      if (e.type === "inventory_changed") void load();
      if (e.type === "wallet_changed") void store.refreshWallet();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function claimDailyGift() {
    setError("");
    setBusy("gift");
    try {
      const res = await api.claimDailyGift();
      await Promise.all([load(), store.refreshWallet()]);
      setNotice(
        res.claimed
          ? `You got ${res.coins} coins${res.itemId ? ` and a ${getItemDefinition(res.itemId)?.name}` : ""}!`
          : "Come back tomorrow for your next gift.",
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function sell(itemId: string) {
    setError("");
    setBusy(itemId);
    try {
      await api.sellItem(itemId, 1);
      await Promise.all([load(), store.refreshWallet()]);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  const byCategory = ITEM_CATEGORIES.map((cat) => ({
    cat,
    entries: (inventory ?? []).filter((e) => getItemDefinition(e.itemId)?.category === cat),
  })).filter((g) => g.entries.length);

  return (
    <Panel title="Inventory" onClose={onClose}>
      <div className="list-row" style={{ marginBottom: 8 }}>
        <span className="row-main">
          <strong>{wallet ?? "…"}</strong> <span className="hint">coins</span>
        </span>
        <button
          type="button"
          className="chip"
          onClick={() => void claimDailyGift()}
          disabled={busy === "gift"}
        >
          Daily gift
        </button>
      </div>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      {!inventory && <p className="hint">Loading…</p>}
      {inventory && !inventory.length && <p className="hint">Nothing yet. Visit a shop in town!</p>}
      {byCategory.map(({ cat, entries }) => (
        <section key={cat}>
          <p className="section-label">{CATEGORY_LABELS[cat]}</p>
          <ul className="list">
            {entries.map((e) => {
              const def = getItemDefinition(e.itemId)!;
              return (
                <li key={e.id} className="list-row">
                  <span className="row-main">
                    <ItemIcon itemId={e.itemId} />
                    <span>
                      {def.name}
                      {e.quantity > 1 && <span className="hint"> ×{e.quantity}</span>}
                    </span>
                  </span>
                  {def.sellPrice !== undefined && (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => void sell(e.itemId)}
                      disabled={busy === e.itemId}
                    >
                      Sell ({def.sellPrice})
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Panel>
  );
}
