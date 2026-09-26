import type { ReportReason } from "@hearth/shared";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { SocialState, SocialStore } from "./store";

/**
 * React contexts and hooks for the social features, kept free of runtime imports (API, Supabase) so
 * screens shared with the offline preview can use them without pulling the server client in.
 */
export const StoreContext = createContext<SocialStore | null>(null);

export type PanelState =
  | { kind: "friends"; tab?: "friends" | "requests" | "add" }
  | { kind: "chat"; conversationId?: string | null }
  | { kind: "settings" }
  | null;

export interface SocialUi {
  openFriends(tab?: "friends" | "requests" | "add"): void;
  openChat(conversationId?: string | null): void;
  openSettings(): void;
  openProfile(handle: string, reportSay?: (reason: ReportReason, note: string) => Promise<unknown>): void;
  close(): void;
  panel: PanelState;
  /** The world registers how to "Go to" a friend's Town Square instance while it's open. */
  setGoTo(handler: ((roomId: string) => void) | null): void;
}

export const SocialUiContext = createContext<SocialUi | null>(null);

export function useSocialUi(): SocialUi {
  const ui = useContext(SocialUiContext);
  if (!ui) throw new Error("useSocialUi outside SocialUiProvider");
  return ui;
}

export function useSocialStore(): SocialStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useSocialStore outside SocialProvider");
  return store;
}

export function useSocial<T>(select: (s: SocialState) => T): T {
  const store = useSocialStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

const noopSubscribe = () => () => undefined;

/** Like useSocial, but returns undefined outside a signed-in app (e.g. the offline preview). */
export function useSocialOptional<T>(select: (s: SocialState) => T): T | undefined {
  const store = useContext(StoreContext);
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, () =>
    store ? select(store.getState()) : undefined,
  );
}
