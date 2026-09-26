/**
 * Where static assets (sprite sheets, tiles) are loaded from. Normally the public folder; the
 * single-file demo build swaps in embedded data URLs instead.
 */
let resolve = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export function assetUrl(path: string): string {
  return resolve(path);
}

export function setAssetResolver(fn: (path: string) => string) {
  resolve = fn;
}
