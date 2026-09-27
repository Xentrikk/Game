import type { ChatMessage, ConversationSummary, FriendsResponse, Presence } from "@hearth/shared";
import { api } from "../api";
import { EventStream, type StreamEvent } from "./events";

export interface PendingMessage {
  id: string;
  body: string;
  status: "sending" | "failed";
}

export interface ThreadState {
  items: ChatMessage[];
  pending: PendingMessage[];
  hasOlder: boolean;
  loaded: boolean;
}

export interface SocialState {
  me: string;
  connected: boolean;
  friends: FriendsResponse | null;
  conversations: ConversationSummary[];
  threads: Record<string, ThreadState>;
  /** conversationId → userId → typing-until timestamp. */
  typing: Record<string, Record<string, number>>;
  openConversation: string | null;
  /** Coin balance, kept current so a toolbar or menu can show it without its own fetch. */
  wallet: number | null;
  /** Whether the mailbox has anything unclaimed (for a badge, like unread chats). */
  mailboxFlag: boolean;
  /** The most recent trade someone updated (including opening one with you), until you open it. */
  pendingTrade: string | null;
}

const PAGE = 50;
const TYPING_MS = 4000;

function insertSorted(items: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (items.some((x) => x.id === m.id)) return items.map((x) => (x.id === m.id ? m : x));
  return [...items, m].sort((a, b) => a.seq - b.seq);
}

/**
 * Everything social the client knows: friends, conversations and loaded messages. Kept current by the
 * live event stream; after a reconnect it re-fetches, and catches each open thread up by seq.
 */
export class SocialStore {
  private state: SocialState;
  private listeners = new Set<() => void>();
  private eventStream = new EventStream();
  private off?: () => void;

  constructor(me: string) {
    this.state = {
      me,
      connected: false,
      friends: null,
      conversations: [],
      threads: {},
      typing: {},
      openConversation: null,
      wallet: null,
      mailboxFlag: false,
      pendingTrade: null,
    };
  }

  /** The live event stream, for panels (trade, letters) that want updates without polling. */
  get stream(): EventStream {
    return this.eventStream;
  }

  // ---------- React integration ----------
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(patch: Partial<SocialState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  start() {
    this.off = this.stream.on((e) => void this.onEvent(e));
    this.stream.start();
  }

  stop() {
    this.off?.();
    this.stream.stop();
  }

  get unreadTotal(): number {
    return this.state.conversations.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
  }

  // ---------- Loading ----------
  async refreshFriends() {
    this.set({ friends: await api.friends() });
  }

  async refreshConversations() {
    const { conversations } = await api.conversations();
    this.set({ conversations });
    // Anything that arrived while we were away has now reached this device: tell the senders.
    for (const c of conversations) {
      const mine = c.members.find((m) => m.profile.id === this.state.me);
      const last = c.lastMessage;
      if (mine && last && last.senderId !== this.state.me && mine.deliveredSeq < last.seq) {
        void api.receipts(c.id, { deliveredSeq: last.seq }).catch(() => undefined);
      }
    }
  }

  private async onEvent(e: StreamEvent) {
    const s = this.state;
    switch (e.type) {
      case "connected":
        this.set({ connected: true });
        await Promise.all([
          this.refreshFriends(),
          this.refreshConversations(),
          this.catchUpThreads(),
          this.refreshWallet(),
          this.refreshMailboxFlag(),
        ]).catch(() => undefined);
        return;
      case "disconnected":
        this.set({ connected: false });
        return;
      case "friends_changed":
        await this.refreshFriends().catch(() => undefined);
        return;
      case "presence":
        if (s.friends) {
          this.set({
            friends: {
              ...s.friends,
              friends: s.friends.friends.map((f) =>
                f.profile.id === e.userId ? { ...f, presence: e.presence } : f,
              ),
            },
          });
        }
        return;
      case "conversation":
        await this.refreshConversations().catch(() => undefined);
        return;
      case "message":
        this.receive(e.message);
        return;
      case "message_updated":
        this.updateMessage(e.message);
        return;
      case "receipt":
        this.set({
          conversations: s.conversations.map((c) =>
            c.id !== e.conversationId
              ? c
              : {
                  ...c,
                  members: c.members.map((m) =>
                    m.profile.id === e.userId
                      ? { ...m, deliveredSeq: e.deliveredSeq, readSeq: e.readSeq }
                      : m,
                  ),
                },
          ),
        });
        return;
      case "typing": {
        const forConv = { ...(s.typing[e.conversationId] ?? {}), [e.userId]: Date.now() + TYPING_MS };
        this.set({ typing: { ...s.typing, [e.conversationId]: forConv } });
        setTimeout(() => this.set({ typing: { ...this.state.typing } }), TYPING_MS + 50);
        return;
      }
      case "wallet_changed":
        this.set({ wallet: e.balance });
        return;
      case "letter":
        this.set({ mailboxFlag: true });
        return;
      case "trade_updated":
        this.set({ pendingTrade: e.tradeId });
        return;
    }
  }

  /** Call when a trade panel opens on this trade, so the notice doesn't linger. */
  clearPendingTrade(tradeId: string) {
    if (this.state.pendingTrade === tradeId) this.set({ pendingTrade: null });
  }

  async refreshWallet() {
    this.set({ wallet: (await api.wallet()).balance });
  }

  async refreshMailboxFlag() {
    this.set({ mailboxFlag: (await api.letters()).mailboxFlag });
  }

  private async catchUpThreads() {
    for (const [id, t] of Object.entries(this.state.threads)) {
      if (!t.loaded) continue;
      const after = t.items.at(-1)?.seq ?? 0;
      const { messages } = await api.messages(id, { after, limit: 100 });
      for (const m of messages) this.receive(m, true);
    }
  }

  private receive(m: ChatMessage, quiet = false) {
    const s = this.state;
    const thread = s.threads[m.conversationId];
    const threads = thread
      ? {
          ...s.threads,
          [m.conversationId]: {
            ...thread,
            items: insertSorted(thread.items, m),
            pending: thread.pending.filter((p) => p.id !== m.id),
          },
        }
      : s.threads;
    const mine = m.senderId === s.me;
    const open = s.openConversation === m.conversationId && document.visibilityState === "visible";
    let known = false;
    const conversations = s.conversations
      .map((c) => {
        if (c.id !== m.conversationId) return c;
        known = true;
        const newer = !c.lastMessage || m.seq >= c.lastMessage.seq;
        return {
          ...c,
          lastMessage: newer ? m : c.lastMessage,
          unread: mine || open || quiet ? c.unread : c.unread + 1,
          myReadSeq: mine || open ? Math.max(c.myReadSeq, m.seq) : c.myReadSeq,
        };
      })
      .sort((a, b) => (b.lastMessage?.seq ?? 0) - (a.lastMessage?.seq ?? 0));
    const typing = s.typing[m.conversationId]
      ? { ...s.typing, [m.conversationId]: { ...s.typing[m.conversationId], [m.senderId ?? ""]: 0 } }
      : s.typing;
    this.set({ threads, conversations, typing });
    if (!known) void this.refreshConversations().catch(() => undefined);
    if (!mine)
      void api
        .receipts(m.conversationId, open ? { readSeq: m.seq } : { deliveredSeq: m.seq })
        .catch(() => undefined);
  }

  private updateMessage(m: ChatMessage) {
    const s = this.state;
    const thread = s.threads[m.conversationId];
    this.set({
      threads: thread
        ? {
            ...s.threads,
            [m.conversationId]: { ...thread, items: thread.items.map((x) => (x.id === m.id ? m : x)) },
          }
        : s.threads,
      conversations: s.conversations.map((c) =>
        c.id === m.conversationId && c.lastMessage?.id === m.id ? { ...c, lastMessage: m } : c,
      ),
    });
  }

  // ---------- Threads ----------
  async open(conversationId: string | null) {
    this.set({ openConversation: conversationId });
    if (!conversationId) return;
    if (!this.state.threads[conversationId]?.loaded) {
      const { messages } = await api.messages(conversationId, { limit: PAGE });
      this.set({
        threads: {
          ...this.state.threads,
          [conversationId]: {
            items: messages,
            pending: [],
            hasOlder: messages.length === PAGE,
            loaded: true,
          },
        },
      });
    }
    await this.markRead(conversationId);
  }

  async markRead(conversationId: string) {
    const last = this.state.threads[conversationId]?.items.at(-1);
    const conv = this.state.conversations.find((c) => c.id === conversationId);
    if (!last || !conv || (conv.myReadSeq >= last.seq && conv.unread === 0)) return;
    this.set({
      conversations: this.state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unread: 0, myReadSeq: last.seq } : c,
      ),
    });
    await api.receipts(conversationId, { readSeq: last.seq }).catch(() => undefined);
  }

  async loadOlder(conversationId: string) {
    const t = this.state.threads[conversationId];
    if (!t?.hasOlder) return;
    const { messages } = await api.messages(conversationId, { before: t.items[0]?.seq, limit: PAGE });
    this.set({
      threads: {
        ...this.state.threads,
        [conversationId]: { ...t, items: [...messages, ...t.items], hasOlder: messages.length === PAGE },
      },
    });
  }

  /** Sends with a client-made id, so retrying after a failure can never duplicate the message. */
  async send(conversationId: string, body: string, id: string = crypto.randomUUID()) {
    const t = this.state.threads[conversationId] ?? {
      items: [],
      pending: [],
      hasOlder: false,
      loaded: false,
    };
    const pending = [...t.pending.filter((p) => p.id !== id), { id, body, status: "sending" as const }];
    this.set({ threads: { ...this.state.threads, [conversationId]: { ...t, pending } } });
    try {
      const { message } = await api.sendMessage(conversationId, id, body);
      this.receive(message);
    } catch (e) {
      const cur = this.state.threads[conversationId]!;
      this.set({
        threads: {
          ...this.state.threads,
          [conversationId]: {
            ...cur,
            pending: cur.pending.map((p) => (p.id === id ? { ...p, status: "failed" } : p)),
          },
        },
      });
      throw e;
    }
  }

  async edit(id: string, body: string) {
    this.updateMessage((await api.editMessage(id, body)).message);
  }

  async remove(id: string) {
    this.updateMessage((await api.deleteMessage(id)).message);
  }

  typingIn(conversationId: string): string[] {
    const now = Date.now();
    return Object.entries(this.state.typing[conversationId] ?? {})
      .filter(([u, until]) => until > now && u !== this.state.me)
      .map(([u]) => u);
  }

  presenceOf(userId: string): Presence | undefined {
    return this.state.friends?.friends.find((f) => f.profile.id === userId)?.presence;
  }
}
