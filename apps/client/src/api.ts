import type {
  ApiError,
  Channel,
  CharacterRequest,
  ChatMessage,
  CoinLedgerEntry,
  ConversationSummary,
  DailyGiftResult,
  FriendsResponse,
  FurniturePlacement,
  GroupIcon,
  HomeAccess,
  HomeSummary,
  InventoryEntry,
  ItemDefinition,
  ItemStack,
  Letter,
  Me,
  PublicProfile,
  Relationship,
  ReportReason,
  SessionTokens,
  Settings,
  ShopId,
  TradeHistoryEntry,
  TradeState,
} from "@hearth/shared";
import { env } from "./env";
import { ApiFailure } from "./errors";
import { supabase } from "./supabase";

export { ApiFailure };

export async function call<T>(method: string, path: string, body?: unknown, authed = true): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authed) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, { error: "offline", message: "Can't reach Hearth. Check your connection." });
  }
  const json = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const err = json as Partial<ApiError>;
    throw new ApiFailure(res.status, {
      error: err.error ?? "unknown",
      message: err.message ?? "Something went wrong.",
      retryAfterSec: err.retryAfterSec,
      attemptsLeft: err.attemptsLeft,
    });
  }
  return json as T;
}

export const api = {
  sendCode: (channel: Channel, target: string, captchaToken?: string) =>
    call<{ target: string; expiresInSec: number }>(
      "POST",
      "/api/auth/otp/send",
      { channel, target, captchaToken },
      false,
    ),
  verifyCode: async (channel: Channel, target: string, code: string) => {
    const { session } = await call<{ session: SessionTokens }>(
      "POST",
      "/api/auth/otp/verify",
      { channel, target, code },
      false,
    );
    const { error } = await supabase.auth.setSession(session);
    if (error) throw new ApiFailure(400, { error: "session", message: error.message });
  },
  me: () => call<Me>("GET", "/api/me"),
  confirmAge: (dob: string) => call<{ ok: true }>("POST", "/api/onboarding/age", { dob }),
  acceptTerms: (tosVersion: string, privacyVersion: string) =>
    call<{ ok: true }>("POST", "/api/onboarding/terms", { tosVersion, privacyVersion }),
  checkHandle: (handle: string) =>
    call<{ available: boolean; handle?: string; message: string }>(
      "GET",
      `/api/handles/${encodeURIComponent(handle)}`,
    ),
  claimHandle: (handle: string) => call<{ handle: string }>("POST", "/api/onboarding/handle", { handle }),
  saveCharacter: (req: CharacterRequest) => call<{ ok: true }>("PUT", "/api/character", req),
  startLink: (channel: Channel, target: string) =>
    call<{ target: string; expiresInSec: number }>("POST", "/api/account/link/send", { channel, target }),
  finishLink: (channel: Channel, target: string, code: string) =>
    call<{ ok: true }>("POST", "/api/account/link/verify", { channel, target, code }),

  // ---------- Friends ----------
  friends: () => call<FriendsResponse>("GET", "/api/friends"),
  friendCode: () => call<{ code: string; inviteUrl: string }>("GET", "/api/friends/code"),
  regenerateFriendCode: () =>
    call<{ code: string; inviteUrl: string }>("POST", "/api/friends/code/regenerate"),
  lookupHandle: (handle: string) =>
    call<{ profile: PublicProfile; relationship: Relationship }>(
      "GET",
      `/api/users/${encodeURIComponent(handle)}`,
    ),
  lookupCode: (code: string) =>
    call<{ profile: PublicProfile; relationship: Relationship }>(
      "GET",
      `/api/friends/code/${encodeURIComponent(code)}`,
    ),
  requestFriend: (by: { handle: string } | { code: string }) =>
    call<{ status: "requested" | "accepted" | "already" }>("POST", "/api/friends/requests", by),
  acceptRequest: (id: string) => call<{ ok: true }>("POST", `/api/friends/requests/${id}/accept`),
  removeRequest: (id: string) => call<{ ok: true }>("DELETE", `/api/friends/requests/${id}`),
  unfriend: (userId: string) => call<{ ok: true }>("DELETE", `/api/friends/${userId}`),
  block: (userId: string) => call<{ ok: true }>("POST", "/api/blocks", { userId }),
  unblock: (userId: string) => call<{ ok: true }>("DELETE", `/api/blocks/${userId}`),
  blocked: () => call<{ blocked: PublicProfile[] }>("GET", "/api/blocks"),
  mute: (userId: string) => call<{ ok: true }>("POST", "/api/mutes", { userId }),
  unmute: (userId: string) => call<{ ok: true }>("DELETE", `/api/mutes/${userId}`),
  mutes: () => call<{ muted: string[] }>("GET", "/api/mutes"),
  report: (r: {
    kind: "user" | "message" | "profile";
    targetUserId: string;
    targetId?: string;
    reason: ReportReason;
    note?: string;
  }) => call<{ id: string }>("POST", "/api/reports", r),

  // ---------- Chat ----------
  conversations: () => call<{ conversations: ConversationSummary[] }>("GET", "/api/conversations"),
  openDm: (userId: string) => call<ConversationSummary>("POST", "/api/conversations/dm", { userId }),
  createGroup: (name: string, icon: GroupIcon, memberIds: string[]) =>
    call<ConversationSummary>("POST", "/api/conversations/group", { name, icon, memberIds }),
  updateGroup: (id: string, patch: { name?: string; icon?: GroupIcon }) =>
    call<ConversationSummary>("PATCH", `/api/conversations/${id}`, patch),
  addToGroup: (id: string, userId: string) =>
    call<ConversationSummary>("POST", `/api/conversations/${id}/members`, { userId }),
  leaveGroup: (id: string) => call<{ ok: true }>("DELETE", `/api/conversations/${id}/members/me`),
  muteConversation: (id: string, muted: boolean) =>
    call<{ ok: true }>("PUT", `/api/conversations/${id}/muted`, { muted }),
  messages: (id: string, q: { before?: number; after?: number; limit?: number } = {}) => {
    const params = new URLSearchParams(
      Object.entries(q)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    return call<{ messages: ChatMessage[] }>("GET", `/api/conversations/${id}/messages?${params}`);
  },
  sendMessage: (conversationId: string, id: string, body: string) =>
    call<{ message: ChatMessage }>("POST", `/api/conversations/${conversationId}/messages`, { id, body }),
  editMessage: (id: string, body: string) =>
    call<{ message: ChatMessage }>("PATCH", `/api/messages/${id}`, { body }),
  deleteMessage: (id: string) => call<{ message: ChatMessage }>("DELETE", `/api/messages/${id}`),
  receipts: (conversationId: string, r: { deliveredSeq?: number; readSeq?: number }) =>
    call<{ deliveredSeq: number; readSeq: number }>(
      "POST",
      `/api/conversations/${conversationId}/receipts`,
      r,
    ),
  typing: (conversationId: string) =>
    call<{ ok: true }>("POST", `/api/conversations/${conversationId}/typing`),

  // ---------- Settings, presence, push ----------
  settings: () => call<Settings>("GET", "/api/settings"),
  updateSettings: (patch: Partial<Settings> | Record<string, unknown>) =>
    call<Settings>("PATCH", "/api/settings", patch),
  setAway: (away: boolean) => call<{ ok: true }>("POST", "/api/presence", { away }),
  pushKey: () => call<{ publicKey: string | null }>("GET", "/api/push/key", undefined, false),
  subscribePush: (sub: PushSubscriptionJSON) => call<{ ok: true }>("POST", "/api/push/subscriptions", sub),

  // ---------- Inventory, wallet and shops ----------
  inventory: () => call<{ inventory: InventoryEntry[] }>("GET", "/api/inventory"),
  wallet: () => call<{ balance: number }>("GET", "/api/wallet"),
  ledger: () => call<{ entries: CoinLedgerEntry[] }>("GET", "/api/wallet/ledger"),
  claimDailyGift: () => call<DailyGiftResult>("POST", "/api/daily-gift/claim"),
  shop: (shopId: ShopId) => call<{ items: ItemDefinition[] }>("GET", `/api/shop/${shopId}`, undefined, false),
  buyItem: (itemId: string, quantity: number) =>
    call<{ balance: number; inventory: InventoryEntry[] }>("POST", "/api/shop/buy", {
      itemId,
      quantity,
      idempotencyKey: crypto.randomUUID(),
    }),
  sellItem: (itemId: string, quantity: number) =>
    call<{ balance: number; inventory: InventoryEntry[] }>("POST", "/api/shop/sell", {
      itemId,
      quantity,
      idempotencyKey: crypto.randomUUID(),
    }),

  // ---------- Homes ----------
  home: (ownerId: string) => call<HomeSummary>("GET", `/api/homes/${ownerId}`),
  homeEntry: (ownerId: string) => call<{ canEnter: boolean }>("GET", `/api/homes/${ownerId}/entry`),
  setHomeAccess: (access: HomeAccess) => call<HomeSummary>("PUT", "/api/homes/access", { access }),
  addHomeGuest: (userId: string) => call<HomeSummary>("POST", "/api/homes/guests", { userId }),
  removeHomeGuest: (userId: string) => call<HomeSummary>("DELETE", `/api/homes/guests/${userId}`),
  homeFurniture: (ownerId: string) =>
    call<{ furniture: FurniturePlacement[] }>("GET", `/api/homes/${ownerId}/furniture`),
  placeFurniture: (itemId: string, x: number, y: number) =>
    call<FurniturePlacement>("POST", "/api/homes/furniture", { itemId, x, y }),
  removeFurniture: (id: string) => call<{ ok: true }>("DELETE", `/api/homes/furniture/${id}`),

  // ---------- Letters ----------
  letters: () => call<{ letters: Letter[]; mailboxFlag: boolean }>("GET", "/api/letters"),
  sentLetters: () => call<{ letters: Letter[] }>("GET", "/api/letters/sent"),
  letter: (id: string) => call<Letter>("GET", `/api/letters/${id}`),
  sendLetter: (req: {
    toUserId: string;
    subject?: string;
    body: string;
    stationeryId?: string;
    items?: ItemStack;
    coins?: number;
  }) => call<Letter>("POST", "/api/letters", req),
  claimLetter: (id: string) => call<Letter>("POST", `/api/letters/${id}/claim`),

  // ---------- Trading ----------
  openTrade: (userId: string) => call<TradeState>("POST", "/api/trades", { userId }),
  tradeHistory: () => call<{ history: TradeHistoryEntry[] }>("GET", "/api/trades/history"),
  trade: (id: string) => call<TradeState>("GET", `/api/trades/${id}`),
  updateTradeOffer: (id: string, items: ItemStack, coins: number) =>
    call<TradeState>("PUT", `/api/trades/${id}/offer`, { items, coins }),
  setTradeReady: (id: string, ready: boolean) =>
    call<TradeState>("POST", `/api/trades/${id}/ready`, { ready }),
  cancelTrade: (id: string) => call<TradeState>("POST", `/api/trades/${id}/cancel`),
  confirmTrade: (id: string) => call<TradeState>("POST", `/api/trades/${id}/confirm`),
};
