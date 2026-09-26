import { z } from "zod";

/**
 * Character appearance catalog. The server validates saved appearances against these IDs, and the
 * client uses the same catalog to build the character creator and draw the sprite layers.
 */

export interface Option {
  id: string;
  name: string;
}
export interface Garment extends Option {
  /** How many palette-swappable color slots this garment has (2 or 3). */
  slots: 2 | 3;
  /** Default color index (into CLOTHING_PALETTE) for each slot. */
  defaults: number[];
}

export const BODIES: Option[] = [
  { id: "slim", name: "Slim" },
  { id: "average", name: "Average" },
  { id: "broad", name: "Broad" },
];

/** [base, shadow] pairs. */
export const SKIN_TONES: [string, string][] = [
  ["#ffe0cc", "#e8b9a0"],
  ["#f9d0b0", "#dba68a"],
  ["#f0c090", "#cf9a6e"],
  ["#e0a878", "#bb8458"],
  ["#c98f5f", "#a36e43"],
  ["#b07848", "#8a5a33"],
  ["#946038", "#704626"],
  ["#7a4a2a", "#58341c"],
  ["#5e3820", "#422614"],
  ["#48291a", "#301a10"],
];

export const HAIR_STYLES: Option[] = [
  { id: "short", name: "Short" },
  { id: "spiky", name: "Spiky" },
  { id: "bob", name: "Bob" },
  { id: "long", name: "Long" },
  { id: "ponytail", name: "Ponytail" },
  { id: "pigtails", name: "Pigtails" },
  { id: "curly", name: "Curly" },
  { id: "puff", name: "Puff" },
  { id: "mohawk", name: "Mohawk" },
  { id: "sidepart", name: "Side part" },
  { id: "bun", name: "Bun" },
  { id: "buzz", name: "Buzz cut" },
];

/** [base, shadow] pairs. */
export const HAIR_COLORS: [string, string][] = [
  ["#2a1d17", "#140d0a"],
  ["#5a3a22", "#3a2414"],
  ["#8a5a2e", "#643e1c"],
  ["#c68a3e", "#9a6628"],
  ["#e8c46a", "#c09a44"],
  ["#b83a1e", "#8a2812"],
  ["#e0e0e0", "#a8a8b0"],
  ["#6a6a74", "#46464e"],
  ["#e87aa8", "#b85880"],
  ["#5aa0e8", "#3a74b8"],
  ["#58c878", "#389a56"],
  ["#9a6ae0", "#7048b0"],
];

export const EYE_STYLES: Option[] = [
  { id: "round", name: "Round" },
  { id: "happy", name: "Happy" },
  { id: "sleepy", name: "Sleepy" },
  { id: "sharp", name: "Sharp" },
  { id: "wide", name: "Wide" },
  { id: "lashes", name: "Lashes" },
  { id: "dot", name: "Dot" },
  { id: "bold", name: "Bold" },
];

export const EYE_COLORS: string[] = [
  "#1e1a2e",
  "#5a3a22",
  "#3a6ab8",
  "#3a8a4a",
  "#8a7a3a",
  "#6a6a7a",
  "#8a3ab8",
  "#b83a3a",
];

/** The 24 colors any garment slot can use. */
export const CLOTHING_PALETTE: string[] = [
  "#f4f4f0", // 0 white
  "#b8b8c0", // 1 light gray
  "#6a6a78", // 2 gray
  "#2a2a36", // 3 charcoal
  "#d83a3a", // 4 red
  "#8a2230", // 5 maroon
  "#f08a3a", // 6 orange
  "#f4d04a", // 7 yellow
  "#c8b078", // 8 khaki
  "#8a6a44", // 9 brown
  "#6ac84a", // 10 green
  "#2a7a44", // 11 forest
  "#4ac8b8", // 12 teal
  "#4a9ae8", // 13 sky
  "#2a4ab8", // 14 blue
  "#1e2a5a", // 15 navy
  "#8a5ae0", // 16 purple
  "#4a2a7a", // 17 plum
  "#f08ac0", // 18 pink
  "#c83a8a", // 19 magenta
  "#f4c8a8", // 20 peach
  "#a8e0c8", // 21 mint
  "#c8b8f0", // 22 lavender
  "#3a5a8a", // 23 denim
];

export const TOPS: Garment[] = [
  { id: "tee", name: "T-shirt", slots: 2, defaults: [13, 0] },
  { id: "striped", name: "Striped tee", slots: 2, defaults: [0, 4] },
  { id: "longsleeve", name: "Long sleeve", slots: 2, defaults: [10, 3] },
  { id: "hoodie", name: "Hoodie", slots: 3, defaults: [16, 22, 3] },
  { id: "jacket", name: "Jacket", slots: 3, defaults: [9, 0, 7] },
  { id: "tank", name: "Tank top", slots: 2, defaults: [7, 0] },
  { id: "sweater", name: "Sweater", slots: 2, defaults: [4, 0] },
  { id: "vest", name: "Vest", slots: 3, defaults: [0, 15, 7] },
  { id: "polo", name: "Polo", slots: 2, defaults: [12, 0] },
  { id: "robe", name: "Wrap top", slots: 3, defaults: [18, 5, 7] },
];

export const BOTTOMS: Garment[] = [
  { id: "shorts", name: "Shorts", slots: 2, defaults: [8, 9] },
  { id: "jeans", name: "Jeans", slots: 2, defaults: [23, 15] },
  { id: "skirt", name: "Skirt", slots: 2, defaults: [4, 5] },
  { id: "longskirt", name: "Long skirt", slots: 2, defaults: [17, 22] },
  { id: "cargo", name: "Cargo pants", slots: 3, defaults: [11, 9, 8] },
  { id: "patched", name: "Patched pants", slots: 3, defaults: [14, 7, 15] },
  { id: "leggings", name: "Leggings", slots: 2, defaults: [3, 2] },
  { id: "joggers", name: "Joggers", slots: 2, defaults: [2, 0] },
  { id: "pleated", name: "Pleated skirt", slots: 2, defaults: [15, 0] },
  { id: "wide", name: "Wide pants", slots: 2, defaults: [0, 1] },
];

export const SHOES: Garment[] = [
  { id: "sneakers", name: "Sneakers", slots: 2, defaults: [4, 0] },
  { id: "boots", name: "Boots", slots: 2, defaults: [9, 3] },
  { id: "sandals", name: "Sandals", slots: 2, defaults: [8, 9] },
  { id: "loafers", name: "Loafers", slots: 2, defaults: [3, 5] },
  { id: "rainboots", name: "Rain boots", slots: 2, defaults: [7, 6] },
  { id: "hightops", name: "High-tops", slots: 3, defaults: [0, 14, 4] },
];

export const ACCESSORIES: Garment[] = [
  { id: "cap", name: "Cap", slots: 2, defaults: [4, 0] },
  { id: "beanie", name: "Beanie", slots: 2, defaults: [11, 0] },
  { id: "glasses", name: "Glasses", slots: 2, defaults: [3, 21] },
  { id: "sunglasses", name: "Sunglasses", slots: 2, defaults: [3, 3] },
  { id: "flower", name: "Flower", slots: 2, defaults: [18, 7] },
  { id: "bow", name: "Bow", slots: 2, defaults: [4, 5] },
  { id: "headband", name: "Headband", slots: 2, defaults: [13, 0] },
  { id: "wizard", name: "Wizard hat", slots: 3, defaults: [16, 7, 17] },
];

const ids = (list: Option[]) => list.map((o) => o.id);
const byId = <T extends Option>(list: T[], id: string) => list.find((o) => o.id === id);

const colorIndex = z
  .number()
  .int()
  .min(0)
  .max(CLOTHING_PALETTE.length - 1);
const garmentChoice = z.object({ id: z.string(), colors: z.array(colorIndex).min(2).max(3) });

function garmentValid(list: Garment[]) {
  return (g: { id: string; colors: number[] }) => {
    const def = byId(list, g.id);
    return !!def && g.colors.length === def.slots;
  };
}

export const appearanceSchema = z
  .object({
    v: z.literal(1),
    body: z.enum(ids(BODIES) as [string, ...string[]]),
    skin: z
      .number()
      .int()
      .min(0)
      .max(SKIN_TONES.length - 1),
    hair: z.object({
      style: z.enum(ids(HAIR_STYLES) as [string, ...string[]]),
      color: z
        .number()
        .int()
        .min(0)
        .max(HAIR_COLORS.length - 1),
    }),
    eyes: z.object({
      style: z.enum(ids(EYE_STYLES) as [string, ...string[]]),
      color: z
        .number()
        .int()
        .min(0)
        .max(EYE_COLORS.length - 1),
    }),
    top: garmentChoice.refine(garmentValid(TOPS), "Unknown top or wrong number of colors."),
    bottom: garmentChoice.refine(garmentValid(BOTTOMS), "Unknown bottom or wrong number of colors."),
    shoes: garmentChoice.refine(garmentValid(SHOES), "Unknown shoes or wrong number of colors."),
    accessory: garmentChoice.refine(garmentValid(ACCESSORIES), "Unknown accessory.").nullable(),
  })
  .strict();

export type Appearance = z.infer<typeof appearanceSchema>;
export type GarmentChoice = z.infer<typeof garmentChoice>;

function wear(list: Garment[], id: string): GarmentChoice {
  const g = byId(list, id);
  if (!g) throw new Error(`Unknown garment ${id}`);
  return { id: g.id, colors: [...g.defaults] };
}

export function defaultAppearance(): Appearance {
  return {
    v: 1,
    body: "average",
    skin: 2,
    hair: { style: "short", color: 1 },
    eyes: { style: "round", color: 0 },
    top: wear(TOPS, "tee"),
    bottom: wear(BOTTOMS, "jeans"),
    shoes: wear(SHOES, "sneakers"),
    accessory: null,
  };
}

/** Random appearance. Pass a seeded `random` in tests. */
export function randomAppearance(random: () => number = Math.random): Appearance {
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)] as T;
  const idx = (n: number) => Math.floor(random() * n);
  const randomGarment = (list: Garment[]): GarmentChoice => {
    const g = pick(list);
    return { id: g.id, colors: Array.from({ length: g.slots }, () => idx(CLOTHING_PALETTE.length)) };
  };
  return {
    v: 1,
    body: pick(BODIES).id,
    skin: idx(SKIN_TONES.length),
    hair: { style: pick(HAIR_STYLES).id, color: idx(HAIR_COLORS.length) },
    eyes: { style: pick(EYE_STYLES).id, color: idx(EYE_COLORS.length) },
    top: randomGarment(TOPS),
    bottom: randomGarment(BOTTOMS),
    shoes: randomGarment(SHOES),
    accessory: random() < 0.4 ? randomGarment(ACCESSORIES) : null,
  };
}

/** Switches a garment slot to a new garment, keeping colors where the slot count allows. */
export function changeGarment(list: Garment[], current: GarmentChoice | null, id: string): GarmentChoice {
  const next = byId(list, id);
  if (!next) throw new Error(`Unknown garment ${id}`);
  const colors = next.defaults.map((d, i) => current?.colors[i] ?? d);
  return { id, colors };
}

export function garmentDef(list: Garment[], id: string): Garment | undefined {
  return byId(list, id);
}
