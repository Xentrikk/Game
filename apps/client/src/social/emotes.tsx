import type { Emote } from "@hearth/shared";

/** 8×8 pixel emote icons, drawn as crisp SVG. */
const ART: Record<Emote, [string, string[]]> = {
  wave: [
    "#f4d04a",
    ["#.#.#...", "#.#.#.#.", "#.#.#.#.", "#######.", "######..", ".#####..", "..###...", "........"],
  ],
  heart: [
    "#f0508a",
    [".##.##..", "#######.", "#######.", ".#####..", "..###...", "...#....", "........", "........"],
  ],
  laugh: [
    "#f4d04a",
    [".#####..", "#######.", "#.#.#.#.", "#######.", "#.....#.", "##...##.", ".#####..", "........"],
  ],
  exclaim: [
    "#f05050",
    ["..##....", "..##....", "..##....", "..##....", "..##....", "........", "..##....", "........"],
  ],
  question: [
    "#4a9ae8",
    [".####...", "##..##..", "....##..", "...##...", "..##....", "........", "..##....", "........"],
  ],
  sleep: [
    "#c8b8f0",
    ["....####", ".....##.", "....##..", "###.####", ".##.....", "##......", "###.....", "........"],
  ],
  music: [
    "#4ac8b8",
    ["..####..", "..#..#..", "..#..#..", "..#..#..", "###.###.", "###.###.", "........", "........"],
  ],
  cry: [
    "#6ab0f0",
    [".#####..", "#######.", "#.#.#.#.", "#######.", "##...##.", "#.###.#.", ".#####..", "#.....#."],
  ],
};

export const EMOTE_LABELS: Record<Emote, string> = {
  wave: "Wave",
  heart: "Heart",
  laugh: "Laugh",
  exclaim: "!",
  question: "?",
  sleep: "Sleepy",
  music: "Music",
  cry: "Cry",
};

export function EmoteIcon({ emote, size = 24 }: { emote: Emote; size?: number }) {
  const [color, rows] = ART[emote];
  return (
    <svg
      className="emote-icon"
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} /> : null,
        ),
      )}
    </svg>
  );
}
