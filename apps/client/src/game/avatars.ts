import { randomAppearance, type Appearance } from "@hearth/shared";
import type Phaser from "phaser";
import { DIRECTIONS, FRAMES, FRAME_H, FRAME_W } from "../sprites/format";
import { composeCharacter } from "../sprites/loader";
import { renderTinyText, isTinyFontText } from "./tinyFont";

/** Frame name for a direction row and animation column in an avatar texture. */
export const frameName = (dirIndex: number, col: number) => `${dirIndex}-${col}`;

/** Creates (once) a Phaser texture for this appearance, with one named frame per direction and column. */
export async function avatarTexture(scene: Phaser.Scene, appearance: Appearance): Promise<string> {
  const key = `avatar:${JSON.stringify(appearance)}`;
  if (scene.textures.exists(key)) return key;
  const canvas = await composeCharacter(appearance);
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.addCanvas(key, canvas)!;
  for (let row = 0; row < DIRECTIONS.length; row++)
    for (let col = 0; col < FRAMES; col++)
      texture.add(frameName(row, col), 0, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
  return key;
}

/** A name tag texture in the tiny pixel font. Falls back to the handle if the name has unsupported characters. */
export function nameTagTexture(scene: Phaser.Scene, name: string, handle: string, color: string): string {
  const text = isTinyFontText(name) && name.trim() ? name.trim() : handle;
  const key = `tag:${color}:${text}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, renderTinyText(text, color));
  return key;
}

/** Deterministic appearance for NPCs, so they look the same for everyone. */
export function npcAppearance(seed: number): Appearance {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return randomAppearance(rand);
}
