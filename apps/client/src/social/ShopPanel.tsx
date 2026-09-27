import { SHOPS, SHOP_NAMES, type ItemDefinition, type ShopId } from "@hearth/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Panel } from "./bits";
import { useSocialStore } from "./context";
import { ItemIcon } from "./ItemIcon";

export function ShopPanel({ onClose, initialShop }: { onClose: () => void; initialShop: ShopId }) {
  const store = useSocialStore();
  const [shopId, setShopId] = useState(initialShop);
  const [items, setItems] = useState<ItemDefinition[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    void api
      .shop(shopId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(describeError(e)));
  }, [shopId]);

  async function buy(itemId: string) {
    setError("");
    setBusy(itemId);
    try {
      await api.buyItem(itemId, 1);
      await store.refreshWallet();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={SHOP_NAMES[shopId]} onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Shops">
        {SHOPS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            className="tab"
            aria-selected={shopId === s}
            onClick={() => setShopId(s)}
          >
            {SHOP_NAMES[s]}
          </button>
        ))}
      </div>
      <p className="error" role="alert">
        {error}
      </p>
      {!items && <p className="hint">Loading…</p>}
      <ul className="list">
        {items?.map((item) => (
          <li key={item.id} className="list-row">
            <span className="row-main">
              <ItemIcon itemId={item.id} />
              <span>
                {item.name}
                <span className="hint block">{item.description}</span>
              </span>
            </span>
            <button
              type="button"
              className="chip"
              onClick={() => void buy(item.id)}
              disabled={busy === item.id}
            >
              Buy ({item.price})
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
