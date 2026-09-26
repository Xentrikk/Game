import type { Emote, FaceMessage, MoveMessage, ReportReason } from "@hearth/shared";

/** One player as the world scene sees them (mirrors PlayerState in the room schema). */
export interface NetPlayer {
  handle: string;
  name: string;
  appearance: string;
  x: number;
  y: number;
  dir: number;
  run: boolean;
  seq: number;
  connected: boolean;
}

export interface PlayerHandlers {
  onAdd(id: string, p: NetPlayer): void;
  onChange(id: string, p: NetPlayer): void;
  onRemove(id: string): void;
}

/**
 * What the world scene needs from "the server". The real game uses a Colyseus room (net.ts);
 * the offline demo uses a local simulation with the same movement rules (demoConnection.ts).
 */
export interface WorldConnection {
  readonly sessionId: string;
  /** Calls onAdd for players already present and for everyone who joins later. */
  subscribe(handlers: PlayerHandlers): void;
  players(): [string, NetPlayer][];
  send(type: "move", msg: MoveMessage): void;
  send(type: "face", msg: FaceMessage): void;
  onDrop(cb: () => void): void;
  onReconnect(cb: () => void): void;
  onLeave(cb: (code: number) => void): void;
  leave(consented?: boolean): Promise<unknown>;
  /** Testing only: cut the network connection without leaving. */
  simulateDrop(): void;
  /** Speak to players nearby (they see a bubble over your head). */
  say(text: string): void;
  emote(emote: Emote): void;
  onSay(cb: (e: { sessionId: string; text: string }) => void): void;
  onEmote(cb: (e: { sessionId: string; emote: Emote }) => void): void;
  /** Reports what someone said nearby; the server attaches the recent conversation. */
  reportSay(sessionId: string, reason: ReportReason, note: string): Promise<void>;
  /** Which Town Square instance this is (for "Go to friend"). */
  readonly roomId: string;
}
