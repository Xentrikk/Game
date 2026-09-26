import { schema, t, type SchemaType } from "@colyseus/schema";

/** Colyseus room state, synced from server to clients at PATCH_MS. */
export const PlayerState = schema(
  {
    handle: t.string(),
    name: t.string(),
    /** Appearance JSON (validated against the catalog when the player joined). */
    appearance: t.string(),
    x: t.uint16(),
    y: t.uint16(),
    /** Index into DIRECTIONS. */
    dir: t.uint8(),
    /** 1 while the last step was a run, so others animate at the right speed. */
    run: t.boolean(),
    /** Last move `seq` the server processed for this player (accepted or rejected). */
    seq: t.uint32(),
    /** False while the player's connection has dropped and the server is holding their spot. */
    connected: t.boolean(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const TownState = schema({ players: t.map(PlayerState) }, "TownState");
export type TownState = SchemaType<typeof TownState>;
