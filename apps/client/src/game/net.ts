import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import { TOWN_ROOM, TownState, type PlayerState } from "@hearth/shared";
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

/** Joins the Town Square on the game server. */
export async function joinTown(): Promise<WorldConnection> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const client = new Client(gameUrl());
  client.auth.token = data.session.access_token;
  const room = (await client.joinOrCreate(TOWN_ROOM, {}, TownState)) as TownRoom;
  return colyseusConnection(room);
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
  };
}
