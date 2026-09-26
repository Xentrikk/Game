import { Client, type Room } from "@colyseus/sdk";
import { TOWN_ROOM, TownState } from "@hearth/shared";
import { env } from "../env";
import { supabase } from "../supabase";

export type TownRoom = Room<unknown, TownState>;

/** Where the game server lives. In dev it runs next to the API on port 2567. */
function gameUrl(): string {
  const configured = import.meta.env.VITE_GAME_URL as string | undefined;
  if (configured) return configured;
  if (env.apiUrl) return env.apiUrl;
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin;
}

export async function joinTown(): Promise<TownRoom> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const client = new Client(gameUrl());
  client.auth.token = data.session.access_token;
  return client.joinOrCreate(TOWN_ROOM, {}, TownState) as Promise<TownRoom>;
}
