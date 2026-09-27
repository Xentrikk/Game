import { ITEM_DEFINITIONS } from "@hearth/shared";
import { assetUrl } from "../assets";

/** Must match COLS in scripts/generate-items.ts. */
const COLS = 8;
const ORDER = [...ITEM_DEFINITIONS.keys()];
const ROWS = Math.ceil(ORDER.length / COLS);

/** One 16×16 pixel-art icon out of the generated sheet (public/items/items.png), scaled crisply. */
export function ItemIcon({ itemId, size = 24 }: { itemId: string; size?: number }) {
  const index = Math.max(0, ORDER.indexOf(itemId));
  const scale = size / 16;
  return (
    <span
      aria-hidden="true"
      className="item-icon"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        backgroundImage: `url(${assetUrl("items/items.png")})`,
        backgroundPosition: `${-(index % COLS) * 16 * scale}px ${-Math.floor(index / COLS) * 16 * scale}px`,
        backgroundSize: `${COLS * 16 * scale}px ${ROWS * 16 * scale}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
      }}
    />
  );
}
