# Art pipeline

Every visual asset — character sprites, the Town Square tileset, the home interior tileset, and item icons — started as a **generated placeholder**: code drew it, not an artist. Character sprites, the home interior tileset and item icons have since been replaced with AI-generated art (see below); the Town Square tileset is still the generated placeholder, pending a better replacement. Any file can be replaced with a hand-drawn or AI-generated one in the same format (size, grid, key colors where noted) and nothing else in the game needs to change; just stop re-running the generator that made it, or (for town.png) CI's "generated town art is up to date" check will overwrite it the next time someone runs the generator.

## Character sprites

The character is built at runtime from layered sprite sheets that are recolored per player. The sheets in `apps/client/public/sprites` are now AI-generated art (all 121 files verified to keep the exact key-color values below and the 64×96/16×24 frame format). `apps/client/scripts/generate-sprites.ts` still exists and produces placeholder sheets in the same format, but CI no longer regenerates or diffs against it — don't run `pnpm sprites` unless you intend to overwrite the current art.

### Sheet format

- **Size:** 64×96 px PNG, made of 16×24 frames.
- **Columns:** idle, step A, passing, step B. The walk cycle plays step A → passing → step B → passing.
- **Rows:** down, left, right, up.
- Pixels are fully opaque or fully transparent. There's no anti-aliasing.

### Key colors

Draw recolorable areas in these exact RGB values. The game swaps them for the player's choices. Any other color is drawn as-is, which is how outlines, eye whites and fixed details work.

| Key                 | RGB                   | Replaced with                   |
| ------------------- | --------------------- | ------------------------------- |
| slot0 / slot0 shade | 255,0,0 / 128,0,0     | Garment main color / its shadow |
| slot1 / slot1 shade | 0,255,0 / 0,128,0     | Garment second color / shadow   |
| slot2 / slot2 shade | 0,0,255 / 0,0,128     | Garment third color / shadow    |
| skin / skin shade   | 255,255,0 / 128,128,0 | Skin tone pair                  |
| hair / hair shade   | 0,255,255 / 0,128,128 | Hair color pair                 |
| eye                 | 255,0,255             | Eye color                       |

Outline color: 26,20,32.

### Files

| Layer                | Path                     | Per body shape?    |
| -------------------- | ------------------------ | ------------------ |
| Body                 | `body/<body>.png`        | yes (one per body) |
| Eyes                 | `eyes/<style>.png`       | no                 |
| Hair behind the body | `hairBack/<style>.png`   | no                 |
| Bottom               | `bottom/<id>_<body>.png` | yes                |
| Top                  | `top/<id>_<body>.png`    | yes                |
| Shoes                | `shoes/<id>_<body>.png`  | yes                |
| Hair in front        | `hairFront/<style>.png`  | no                 |
| Accessory            | `accessory/<id>.png`     | no                 |

Layers are drawn in the order above (PROMPT.md Section 5). Option IDs come from `packages/shared/src/appearance.ts`.

### Checking your work

```sh
pnpm --filter @hearth/client exec tsx scripts/preview-sprites.ts 6 7 preview.png   # contact sheet of random characters
pnpm --filter @hearth/client test                                                 # every option has a sheet
```

If you replace a generated sheet with hand-drawn art, remove that option from the generator (or stop running it). Otherwise CI's "sprites up to date" check will flag the difference.

**Current style note:** the placeholder sheets are flat-shaded (2 tones per recolorable area). Hand-drawn or AI-generated replacements can go richer — more shading steps, texture, a consistent top-left light source — the same way the tile art below was pushed further; see `docs/decisions.md` (post–Phase 4 entries) for the exact technique (ramp shading + ordered dithering) if you want the sprites to match. The one hard constraint is the key-color table above: whatever detail you add, recolorable pixels must still land on one of those exact key RGB values so the runtime recoloring keeps working.

## Town Square tiles and map

- **Tileset:** `apps/client/public/tiles/town.png`, 16×16 tiles, 8 columns. Still the **generated placeholder** — an AI-regenerated attempt was tried and rejected (see `docs/decisions.md`): it didn't preserve the multi-tile composite objects (the 2×2 tree, 2×2 fountain, 2×2 portal, paired benches, connected roof triplets) or the intended fantasy palette. Any future replacement needs to treat those grid cells as parts of one larger object that must align seamlessly with its neighbors, not independent icons. The whole area uses **at most 64 colors**; the generator (`scripts/generate-town.ts`) refuses to write more and throws with the actual count if you add colors past that. Surfaces are shaded from named ramps (grass, path, stone, water, wood, foliage, three roof colors, wall/plaster) with ordered (Bayer 4×4) dithering between bands and a consistent top-left light source, plus soft grounding shadows under standing objects (trees, benches, the fountain, the portal, lamps, the notice board).
- **Map:** `packages/shared/maps/town.json`, Tiled JSON with an embedded tileset. Layers:
  - `ground`: floor tiles.
  - `decor`: objects drawn under characters.
  - `overhead`: tree canopies and lamp tops, drawn over characters.
  - `objects`: point objects.
- **Collision:** tiles with the boolean property `collides` block movement on the `ground` and `decor` layers. The `blocker` tile is invisible and collision-only.
- **Objects:** `type` is `spawn`, `sign` (property `text`) or `npc` (properties `text`, `dir`, `seed`). In `text`, a blank line starts a new dialogue page.
- The server and client both read this one file, so editing it in Tiled changes collision for everyone. Run `pnpm --filter @hearth/shared test` afterwards: the map tests check that every sign and NPC can be reached and nobody can walk off the map.
- Preview: `pnpm --filter @hearth/client exec tsx scripts/preview-town.ts` renders the whole map to a PNG.

## Home interior tiles and map

- **Tileset:** `apps/client/public/tiles/home.png`, 16×16 tiles, 6 columns. Now AI-generated art (replacing the generated placeholder); `scripts/generate-home.ts` still exists for reference but CI doesn't check against it. Tiles: `floor`/`floor2` (wood planks), `rug` (a seamless repeating diamond-medallion pattern — it tiles edge to edge, so don't add a per-tile border or it'll look like a grid of separate rugs), `wall`, `wallWindow`, `door`, `blocker`.
- **Map:** `packages/shared/maps/home.json`, same Tiled JSON shape as the town map (`ground`/`decor`/`overhead`/`objects`), but the floor is exactly `HOME_GRID_W`×`HOME_GRID_H` (`packages/shared/src/economy.ts`, currently 10×8) plus a one-tile wall border, because a furniture placement's `(x, y)` lines up 1:1 with a walkable interior tile. **Don't change the floor size** without updating `HOME_GRID_W`/`HOME_GRID_H` too.
- The border is a **single tile row/column repeated** around the room (not real multi-tile-tall walls), so avoid any design that only makes sense stacked once (a knee-height wainscot band, for example, repeats into a barber-pole stripe when tiled — texture the whole tile instead).
- Preview: `pnpm --filter @hearth/client exec tsx scripts/preview-home.ts` renders the room to a PNG.

## Item icons

- **Sheet:** `apps/client/public/items/items.png`, 16×16 icons, 8 columns. Now AI-generated art (replacing the generated placeholder); `scripts/generate-items.ts` still exists for reference but CI doesn't check against it. One icon per item in the shared catalog (`packages/shared/items/*.json`), in the exact order `ITEM_DEFINITIONS` iterates them (the five category files, each in file order: `cosmetics.json`, `furniture.json`, `collectibles.json`, `consumables.json`, `stationery.json` — currently 23 items total). The client (`src/social/ItemIcon.tsx`) reads an icon back out by that same index, so **the grid order must match the catalog order exactly** — don't reorder, insert, or remove an icon without also changing the catalog (or vice versa).
- Current placeholder style: one silhouette per category (a badge for cosmetics, a chair for furniture, a gem for collectibles, a cup for consumables, an envelope for stationery), a 5-tone ramp colored by a hash of the item's id (so items in the same category still look distinct), a soft same-hue rim light, a small drop shadow, and a gold sparkle on rare items.
- No hard color-count limit (each icon is independent, not a shared tileset), but keep a limited, consistent palette per icon for the pixel-art look.
