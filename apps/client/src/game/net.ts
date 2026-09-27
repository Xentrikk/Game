import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import { HOME_ROOM, TOWN_ROOM, TownState, type PlayerState } from "@hearth/shared";
import { api } from "../api";
import { env } from "../env";
import { supabase } from "../supabase";
import type { NetPlayer, WorldConnection } from "./connection";

type TownRoom = Room<unknown, TownState>;

/** Where the game server lives. In dev it runs next to the API on port 2567. */
function gameUrl(): string {
  const configured = import.meta.env.VITE_GAME_URL as string | undefined;
  if (configured) return configured;
  if (env.apiUrl) return env.apiUrl;
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin;
}

/**
 * Joins the Town Square on the game server. With `roomId`, joins that instance ("Go to friend");
 * otherwise prefers an instance where a friend already is, then any instance with room.
 */
export async function joinTown(opts: { roomId?: string } = {}): Promise<WorldConnection> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const client = new Client(gameUrl());
  client.auth.token = data.session.access_token;
  const preferred = opts.roomId
    ? [opts.roomId]
    : await api
        .friends()
        .then((f) => [
          ...new Set(f.friends.flatMap((x) => (x.presence.location ? [x.presence.location.roomId] : []))),
        ])
        .catch(() => [] as string[]);
  for (const roomId of preferred) {
    try {
      return colyseusConnection((await client.joinById(roomId, {}, TownState)) as TownRoom);
    } catch {
      // Full or gone: try the next one.
    }
  }
  return colyseusConnection((await client.joinOrCreate(TOWN_ROOM, {}, TownState)) as TownRoom);
}

/** Joins a private home: your own, or (if they let you in) a friend's. */
export async function joinHome(ownerId: string): Promise<WorldConnection> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const client = new Client(gameUrl());
  client.auth.token = data.session.access_token;
  return colyseusConnection((await client.joinOrCreate(HOME_ROOM, { ownerId }, TownState)) as TownRoom);
}

function colyseusConnection(room: TownRoom): WorldConnection {
  const asNet = (p: PlayerState) => p as unknown as NetPlayer;
  return {
    get sessionId() {
      return room.sessionId;
    },
    subscribe(h) {
      const $ = getStateCallbacks(room);
      $(room.state).players.onAdd((p: PlayerState, id: string) => {
        h.onAdd(id, asNet(p));
        $(p).onChange(() => h.onChange(id, asNet(p)));
      });
      $(room.state).players.onRemove((_p: PlayerState, id: string) => h.onRemove(id));
    },
    players: () => [...room.state.players.entries()].map(([id, p]) => [id, asNet(p)] as [string, NetPlayer]),
    send: (type: string, msg: unknown) => room.send(type, msg),
    onDrop: (cb) => void room.onDrop(cb),
    onReconnect: (cb) => void room.onReconnect(cb),
    onLeave: (cb) => void room.onLeave(cb),
    leave: (consented = true) => room.leave(consented),
    simulateDrop: () => (room.connection as unknown as { transport: { ws: WebSocket } }).transport.ws.close(),
    get roomId() {
      return room.roomId;
    },
    say: (text) => room.send("say", { text }),
    emote: (emote) => room.send("emote", { emote }),
    onSay: (cb) => void room.onMessage("say", cb),
    onEmote: (cb) => void room.onMessage("emote", cb),
    reportSay: (sessionId, reason, note) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The report didn't go through. Try again.")), 8000);
        const off = room.onMessage("reported", () => {
          clearTimeout(timer);
          off();
          resolve();
        });
        room.send("report_say", { sessionId, reason, note });
      }),
  };
}
