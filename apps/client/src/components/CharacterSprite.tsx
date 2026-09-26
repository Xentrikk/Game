import type { Appearance } from "@hearth/shared";
import { useEffect, useRef, useState } from "react";
import { DIRECTIONS, FRAME_H, FRAME_W, WALK_CYCLE, type Direction } from "../sprites/format";
import { composeCharacter } from "../sprites/loader";
import { usePrefersReducedMotion } from "./motion";

const WALK_FPS = 6;
const ROTATE_EVERY_MS = 2000;

interface Props {
  appearance: Appearance;
  /** Integer scale factor (pixel art is only ever scaled by whole numbers). */
  scale?: number;
  direction?: Direction;
  walking?: boolean;
  /** Turn through all four directions automatically. */
  rotate?: boolean;
  label?: string;
}

/** Draws a composited character, optionally walking and turning. */
export function CharacterSprite({
  appearance,
  scale = 6,
  direction = "down",
  walking = true,
  rotate = false,
  label,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);
  const [tick, setTick] = useState(0);
  const reduced = usePrefersReducedMotion();
  const animate = walking && !reduced;
  const key = JSON.stringify(appearance);

  useEffect(() => {
    let cancelled = false;
    composeCharacter(appearance)
      .then((c) => !cancelled && setSheet(c))
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
    // Recompose only when the appearance actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!animate && !rotate) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000 / WALK_FPS);
    return () => clearInterval(t);
  }, [animate, rotate]);

  const dir: Direction = rotate
    ? DIRECTIONS[Math.floor((tick * (1000 / WALK_FPS)) / ROTATE_EVERY_MS) % DIRECTIONS.length]!
    : direction;
  const frame = animate ? WALK_CYCLE[tick % WALK_CYCLE.length]! : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheet) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const row = DIRECTIONS.indexOf(dir);
    ctx.drawImage(
      sheet,
      frame * FRAME_W,
      row * FRAME_H,
      FRAME_W,
      FRAME_H,
      0,
      0,
      FRAME_W * scale,
      FRAME_H * scale,
    );
  }, [sheet, dir, frame, scale]);

  return (
    <canvas
      ref={canvasRef}
      className="sprite"
      width={FRAME_W * scale}
      height={FRAME_H * scale}
      role="img"
      aria-label={label ?? "Your character"}
      data-ready={sheet ? "true" : "false"}
    />
  );
}
