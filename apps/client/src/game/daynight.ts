/**
 * Multiply tint for the player's local time of day. White means no tint.
 * Kept to a few steps rather than a smooth gradient, like old handhelds' day/night palettes.
 */
export function tintForHour(hour: number): number {
  if (hour >= 7 && hour < 17) return 0xffffff; // day
  if (hour >= 17 && hour < 19) return 0xffd8b8; // golden hour
  if (hour >= 19 && hour < 21) return 0xb8b0e0; // evening
  if (hour >= 5 && hour < 7) return 0xd8d0f0; // dawn
  return 0x8088c0; // night
}
