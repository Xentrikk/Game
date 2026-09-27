import {
  HOME_ACCESS_LABELS,
  HOME_ACCESS_LEVELS,
  HOME_GRID_H,
  HOME_GRID_W,
  getItemDefinition,
  type FurniturePlacement,
  type HomeAccess,
  type HomeSummary,
  type InventoryEntry,
} from "@hearth/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Avatar, Panel } from "./bits";
import { useSocial } from "./context";
import { ItemIcon } from "./ItemIcon";

/** Lets a home's owner set who can visit, manage the invite list, and place or remove furniture. */
export function HomeManagePanel({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const friends = useSocial((s) => s.friends);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [furniture, setFurniture] = useState<FurniturePlacement[] | null>(null);
  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [armed, setArmed] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    Promise.all([api.home(ownerId), api.homeFurniture(ownerId)]).then(([s, f]) => {
      setSummary(s);
      setFurniture(f.furniture);
    });

  useEffect(() => {
    void load().catch((e) => setError(describeError(e)));
    void api.inventory().then((r) => setInventory(r.inventory));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setAccess(access: HomeAccess) {
    setError("");
    try {
      setSummary(await api.setHomeAccess(access));
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function toggleGuest(userId: string, isGuest: boolean) {
    setError("");
    try {
      setSummary(isGuest ? await api.removeHomeGuest(userId) : await api.addHomeGuest(userId));
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function placeAt(x: number, y: number) {
    if (!armed) return;
    setError("");
    try {
      await api.placeFurniture(armed, x, y);
      await load();
      const left = inventory.find((e) => e.itemId === armed);
      if (!left || left.quantity <= 1) setArmed("");
      setInventory((await api.inventory()).inventory);
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function removeAt(id: string) {
    setError("");
    try {
      await api.removeFurniture(id);
      await load();
      setInventory((await api.inventory()).inventory);
    } catch (e) {
      setError(describeError(e));
    }
  }

  const furnitureItems = inventory.filter((e) => getItemDefinition(e.itemId)?.category === "furniture");
  const atCell = (x: number, y: number) => furniture?.find((f) => f.x === x && f.y === y);

  return (
    <Panel title="Manage your home" onClose={onClose}>
      <p className="error" role="alert">
        {error}
      </p>
      <p className="section-label">Who can visit</p>
      <div className="tabs" role="radiogroup" aria-label="Who can visit">
        {HOME_ACCESS_LEVELS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={summary?.access === a}
            className="tab"
            aria-selected={summary?.access === a}
            onClick={() => void setAccess(a)}
          >
            {HOME_ACCESS_LABELS[a]}
          </button>
        ))}
      </div>

      {summary?.access === "invite" && (
        <>
          <p className="section-label">Guest list</p>
          <ul className="list">
            {friends?.friends.map((f) => {
              const isGuest = summary.guests?.some((g) => g.id === f.profile.id) ?? false;
              return (
                <li key={f.profile.id} className="list-row">
                  <span className="row-main">
                    <Avatar profile={f.profile} /> {f.profile.displayName}
                  </span>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void toggleGuest(f.profile.id, isGuest)}
                  >
                    {isGuest ? "Remove" : "Invite"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="section-label">Furniture</p>
      <p className="hint">
        Pick a piece, then tap a tile to place it. Tap placed furniture to pick it back up.
      </p>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        {furnitureItems.map((e) => (
          <button
            key={e.id}
            type="button"
            className="chip"
            aria-pressed={armed === e.itemId}
            onClick={() => setArmed(armed === e.itemId ? "" : e.itemId)}
          >
            <ItemIcon itemId={e.itemId} size={20} /> {getItemDefinition(e.itemId)?.name} ×{e.quantity}
          </button>
        ))}
        {!furnitureItems.length && <p className="hint">Buy furniture at the General Store first.</p>}
      </div>
      <div
        className="home-grid"
        style={{ display: "grid", gridTemplateColumns: `repeat(${HOME_GRID_W}, 20px)`, gap: 2 }}
      >
        {Array.from({ length: HOME_GRID_H }, (_, y) =>
          Array.from({ length: HOME_GRID_W }, (_, x) => {
            const placed = atCell(x, y);
            return (
              <button
                key={`${x}-${y}`}
                type="button"
                className="home-tile"
                style={{
                  width: 20,
                  height: 20,
                  padding: 0,
                  border: "1px solid var(--border, #8a8a98)",
                  background: placed ? "transparent" : undefined,
                }}
                onClick={() => (placed ? void removeAt(placed.id) : void placeAt(x, y))}
                aria-label={
                  placed ? `Remove ${getItemDefinition(placed.itemId)?.name}` : `Place at ${x}, ${y}`
                }
              >
                {placed && <ItemIcon itemId={placed.itemId} size={18} />}
              </button>
            );
          }),
        )}
      </div>
    </Panel>
  );
}
