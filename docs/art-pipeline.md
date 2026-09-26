# Art pipeline: character sprites

The character is built at runtime from layered sprite sheets that are recolored per player. The sheets in `apps/client/public/sprites` are **placeholders** made by `apps/client/scripts/generate-sprites.ts`. An artist can replace any file with a hand-drawn one in the same format, and nothing else needs to change.

## Sheet format

- **Size:** 64×96 px PNG, made of 16×24 frames.
- **Columns:** idle, step A, passing, step B. The walk cycle plays step A → passing → step B → passing.
- **Rows:** down, left, right, up.
- Pixels are fully opaque or fully transparent. There's no anti-aliasing.

## Key colors

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

## Files

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

## Checking your work

```sh
pnpm --filter @hearth/client exec tsx scripts/preview-sprites.ts 6 7 preview.png   # contact sheet of random characters
pnpm --filter @hearth/client test                                                 # every option has a sheet
```

If you replace a generated sheet with hand-drawn art, remove that option from the generator (or stop running it). Otherwise CI's "sprites up to date" check will flag the difference.

# Town Square tiles and map

- **Tileset:** `apps/client/public/tiles/town.png`, 16×16 tiles, 8 columns. The whole area must use **at most 32 colors** (PROMPT.md Section 3). The generator refuses to write more, and the placeholder uses 31.
- **Map:** `packages/shared/maps/town.json`, Tiled JSON with an embedded tileset. Layers:
  - `ground`: floor tiles.
  - `decor`: objects drawn under characters.
  - `overhead`: tree canopies and lamp tops, drawn over characters.
  - `objects`: point objects.
- **Collision:** tiles with the boolean property `collides` block movement on the `ground` and `decor` layers. The `blocker` tile is invisible and collision-only.
- **Objects:** `type` is `spawn`, `sign` (property `text`) or `npc` (properties `text`, `dir`, `seed`). In `text`, a blank line starts a new dialogue page.
- The server and client both read this one file, so editing it in Tiled changes collision for everyone. Run `pnpm --filter @hearth/shared test` afterwards: the map tests check that every sign and NPC can be reached and nobody can walk off the map.
