import { z } from "zod";
import type { Appearance } from "./appearance";
import { containsProfanity } from "./filter";

// ---------- Friends ----------

/** Friend codes avoid look-alike characters (no I, O, 0 or 1). */
export const FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const FRIEND_CODE_LENGTH = 8;
export const FRIEND_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/** Accepts "abcd efgh", "ABCD-EFGH" and similar, returning the canonical code or null. */
export function normalizeFriendCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return FRIEND_CODE_PATTERN.test(code) ? code : null;
}

/** "ABCDEFGH" → "ABCD-EFGH", for display. */
export function formatFriendCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export const friendRequestSchema = z.union([
  z.object({ handle: z.string().min(1).max(32) }).strict(),
  z.object({ code: z.string().min(1).max(16) }).strict(),
]);

export const userIdSchema = z.object({ userId: z.string().uuid() }).strict();

export const REPORT_REASONS = [
  "harassment",
  "hate",
  "sexual",
  "spam",
  "self_harm",
  "impersonation",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: "Bullying or harassment",
  hate: "Hate or slurs",
  sexual: "Sexual content",
  spam: "Spam or scams",
  self_harm: "They might hurt themselves",
  impersonation: "Pretending to be someone",
  other: "Something else",
};

export const reportSchema = z
  .object({
    kind: z.enum(["user", "message", "profile"]),
    targetUserId: z.string().uuid(),
    /** The message id, for message reports. */
    targetId: z.string().uuid().optional(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().max(500).default(""),
  })
  .strict();

// ---------- Profiles, presence ----------

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string;
  pronouns: string;
  bio: string;
  appearance: Appearance | null;
}

export type PresenceStatus = "online" | "away" | "dnd" | "offline";
export interface Presence {
  status: PresenceStatus;
  /** Where they are, when they're in the world and share it with friends. */
  location: { kind: "town"; roomId: string } | null;
}

export type Relationship = "self" | "friends" | "outgoing" | "incoming" | "none" | "blocked";

export interface FriendEntry {
  profile: PublicProfile;
  since: string;
  presence: Presence;
}

export interface FriendRequestEntry {
  id: string;
  profile: PublicProfile;
  createdAt: string;
}

export interface FriendsResponse {
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
}

// ---------- Settings ----------

export const PRESENCE_MODES = ["auto", "dnd", "invisible"] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const settingsSchema = z.object({
  /** Off: others don't see when you've read their messages (and you don't see theirs). */
  readReceipts: z.boolean().default(true),
  /** auto = online/away automatically; dnd = Do Not Disturb; invisible = appear offline. */
  presence: z.enum(PRESENCE_MODES).default("auto"),
  /** Friends can see where you are in the world. */
  shareLocation: z.boolean().default(true),
  notifications: z
    .object({
      dm: z.boolean().default(true),
      group: z.boolean().default(true),
      friendRequest: z.boolean().default(true),
    })
    .default({}),
  quietHours: z
    .object({ enabled: z.boolean().default(false), start: time.default("22:00"), end: time.default("07:00") })
    .default({}),
  /** IANA time zone, for quiet hours. */
  timeZone: z.string().max(64).default("UTC"),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.deepPartial();

// ---------- Chat ----------

export const MESSAGE_MAX = 2000;
export const GROUP_MAX_MEMBERS = 20;
export const GROUP_NAME_MAX = 30;
/** Editing is allowed for this long after sending. */
export const EDIT_WINDOW_MS = 5 * 60 * 1000;
export const GROUP_ICONS = ["star", "heart", "leaf", "moon", "sun", "music", "fish", "cat"] as const;
export type GroupIcon = (typeof GROUP_ICONS)[number];

const messageBody = z.string().trim().min(1, "Write a message first.").max(MESSAGE_MAX);

export const sendMessageSchema = z.object({ id: z.string().uuid(), body: messageBody }).strict();
export const editMessageSchema = z.object({ body: messageBody }).strict();
export const createGroupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the group a name.")
      .max(GROUP_NAME_MAX)
      .refine((v) => !containsProfanity(v), "That name isn't allowed."),
    icon: z.enum(GROUP_ICONS),
    memberIds: z
      .array(z.string().uuid())
      .min(1)
      .max(GROUP_MAX_MEMBERS - 1),
  })
  .strict();
export const updateGroupSchema = createGroupSchema.pick({ name: true, icon: true }).partial().strict();
export const receiptsSchema = z
  .object({ deliveredSeq: z.number().int().min(0).optional(), readSeq: z.number().int().min(0).optional() })
  .strict();

export interface ChatMessage {
  id: string;
  seq: number;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface ConversationMember {
  profile: PublicProfile;
  /** Null when hidden (read receipts turned off by them or by you). */
  readSeq: number | null;
  deliveredSeq: number;
}

export interface ConversationSummary {
  id: string;
  kind: "dm" | "group";
  name: string;
  icon: string;
  members: ConversationMember[];
  lastMessage: ChatMessage | null;
  unread: number;
  myReadSeq: number;
  muted: boolean;
}

// ---------- Live events (server → client over /api/events) ----------

export type ServerEvent =
  | { type: "hello" }
  | { type: "message"; message: ChatMessage }
  | { type: "message_updated"; message: ChatMessage }
  | { type: "receipt"; conversationId: string; userId: string; deliveredSeq: number; readSeq: number | null }
  | { type: "typing"; conversationId: string; userId: string }
  | { type: "conversation"; conversationId: string }
  | { type: "friends_changed" }
  | { type: "presence"; userId: string; presence: Presence };

// ---------- World chat ----------

export const SAY_MAX = 200;
/** Say reaches players within this many tiles (Chebyshev distance). */
export const SAY_RANGE_TILES = 6;
export const EMOTES = ["wave", "heart", "laugh", "exclaim", "question", "sleep", "music", "cry"] as const;
export type Emote = (typeof EMOTES)[number];

/** How long a speech bubble stays up (PROMPT.md Section 7.1). */
export function bubbleMs(text: string): number {
  return 5000 + 60 * text.length;
}

/** Replaces profane words with asterisks (for Say, where we mask rather than reject). */
export function maskProfanity(text: string): string {
  return text.replace(/\S+/g, (word) => (containsProfanity(word) ? "*".repeat(word.length) : word));
}

export const sayMessage = z.object({ text: z.string().trim().min(1).max(SAY_MAX) }).strict();
export const emoteMessage = z.object({ emote: z.enum(EMOTES) }).strict();
export const reportSayMessage = z
  .object({
    sessionId: z.string().min(1).max(64),
    reason: z.enum(REPORT_REASONS),
    note: z.string().max(500).default(""),
  })
  .strict();
