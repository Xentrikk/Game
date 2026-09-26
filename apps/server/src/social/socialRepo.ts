import { randomInt } from "node:crypto";
import {
  FRIEND_CODE_ALPHABET,
  FRIEND_CODE_LENGTH,
  settingsSchema,
  type Appearance,
  type PublicProfile,
  type Relationship,
  type ReportReason,
  type Settings,
} from "@hearth/shared";
import type { Sql } from "../db";

interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  pronouns: string;
  bio: string;
  appearance: Appearance | null;
}

export function toProfile(r: ProfileRow): PublicProfile {
  return {
    id: r.user_id,
    handle: r.handle,
    displayName: r.display_name,
    pronouns: r.pronouns,
    bio: r.bio,
    appearance: r.appearance,
  };
}

function newFriendCode(): string {
  let code = "";
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++)
    code += FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)];
  return code;
}

/** Friends, requests, blocks, mutes, reports and settings. Every method is scoped to the calling user. */
export class SocialRepo {
  constructor(private sql: Sql) {}

  private profileSelect() {
    return this.sql`
      select p.user_id, p.handle::text as handle, p.display_name, p.pronouns, p.bio, a.data as appearance
      from public.profiles p left join public.appearances a on a.user_id = p.user_id`;
  }

  async profiles(ids: string[]): Promise<Map<string, PublicProfile>> {
    if (!ids.length) return new Map();
    const rows = await this.sql<ProfileRow[]>`${this.profileSelect()} where p.user_id = any(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.user_id, toProfile(r)]));
  }

  async profileByHandle(handle: string): Promise<PublicProfile | null> {
    const [row] = await this.sql<ProfileRow[]>`${this.profileSelect()} where p.handle = ${handle}`;
    return row ? toProfile(row) : null;
  }

  async userIdByFriendCode(code: string): Promise<string | null> {
    const [row] = await this.sql<
      { user_id: string }[]
    >`select user_id from public.profiles where friend_code = ${code}`;
    return row?.user_id ?? null;
  }

  /** The user's friend code, creating one the first time. */
  async friendCode(userId: string): Promise<string> {
    const [row] = await this.sql<{ friend_code: string | null }[]>`
      select friend_code from public.profiles where user_id = ${userId}`;
    if (!row) throw new Error("no profile");
    return row.friend_code ?? this.regenerateFriendCode(userId);
  }

  async regenerateFriendCode(userId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newFriendCode();
      try {
        await this.sql`update public.profiles set friend_code = ${code} where user_id = ${userId}`;
        return code;
      } catch (e) {
        if ((e as { code?: string }).code !== "23505") throw e; // collision: try another code
      }
    }
    throw new Error("could not allocate a friend code");
  }

  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    const [row] = await this.sql<{ b: boolean }[]>`select public.is_blocked_between(${a}, ${b}) as b`;
    return !!row?.b;
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const [row] = await this.sql<{ f: boolean }[]>`select public.are_friends(${a}, ${b}) as f`;
    return !!row?.f;
  }

  async relationship(me: string, other: string): Promise<Relationship> {
    if (me === other) return "self";
    const [row] = await this.sql<
      { blocked: boolean; friends: boolean; outgoing: boolean; incoming: boolean }[]
    >`
      select public.is_blocked_between(${me}, ${other}) as blocked,
             public.are_friends(${me}, ${other}) as friends,
             exists(select 1 from public.friend_requests where from_user = ${me} and to_user = ${other}) as outgoing,
             exists(select 1 from public.friend_requests where from_user = ${other} and to_user = ${me}) as incoming`;
    if (row!.blocked) return "blocked";
    if (row!.friends) return "friends";
    if (row!.outgoing) return "outgoing";
    if (row!.incoming) return "incoming";
    return "none";
  }

  async friendIds(userId: string): Promise<string[]> {
    const rows = await this.sql<{ id: string }[]>`
      select case when user_a = ${userId} then user_b else user_a end as id
      from public.friendships where ${userId} in (user_a, user_b)`;
    return rows.map((r) => r.id);
  }

  async friends(userId: string): Promise<{ profile: PublicProfile; since: string }[]> {
    const rows = await this.sql<(ProfileRow & { since: Date })[]>`
      with f as (
        select case when user_a = ${userId} then user_b else user_a end as id, created_at
        from public.friendships where ${userId} in (user_a, user_b)
      )
      select p.user_id, p.handle::text as handle, p.display_name, p.pronouns, p.bio, a.data as appearance,
             f.created_at as since
      from f join public.profiles p on p.user_id = f.id
      left join public.appearances a on a.user_id = p.user_id
      order by lower(p.display_name)`;
    return rows.map((r) => ({ profile: toProfile(r), since: r.since.toISOString() }));
  }

  async requests(userId: string) {
    const rows = await this.sql<(ProfileRow & { id: string; created_at: Date; incoming: boolean })[]>`
      select r.id, r.created_at, (r.to_user = ${userId}) as incoming,
             p.user_id, p.handle::text as handle, p.display_name, p.pronouns, p.bio, a.data as appearance
      from public.friend_requests r
      join public.profiles p on p.user_id = case when r.to_user = ${userId} then r.from_user else r.to_user end
      left join public.appearances a on a.user_id = p.user_id
      where ${userId} in (r.from_user, r.to_user)
      order by r.created_at desc`;
    const entry = (r: (typeof rows)[number]) => ({
      id: r.id,
      profile: toProfile(r),
      createdAt: r.created_at.toISOString(),
    });
    return {
      incoming: rows.filter((r) => r.incoming).map(entry),
      outgoing: rows.filter((r) => !r.incoming).map(entry),
    };
  }

  /**
   * Sends a friend request. If `to` already asked `from`, they become friends instead.
   * Returns what happened, or "ignored" when a block exists (the caller must not reveal that).
   */
  async sendRequest(from: string, to: string): Promise<"requested" | "accepted" | "already" | "ignored"> {
    return this.sql.begin(async (tx) => {
      const [state] = await tx<{ blocked: boolean; friends: boolean; reverse: string | null }[]>`
        select public.is_blocked_between(${from}, ${to}) as blocked,
               public.are_friends(${from}, ${to}) as friends,
               (select id from public.friend_requests where from_user = ${to} and to_user = ${from}) as reverse`;
      if (state!.blocked) return "ignored";
      if (state!.friends) return "already";
      if (state!.reverse) {
        await tx`select public.accept_friend_request(${state!.reverse}, ${from})`;
        return "accepted";
      }
      const rows = await tx`
        insert into public.friend_requests (from_user, to_user) values (${from}, ${to})
        on conflict (from_user, to_user) do nothing returning id`;
      return rows.length ? "requested" : "already";
    });
  }

  async acceptRequest(requestId: string, me: string): Promise<string | null> {
    const [row] = await this.sql<
      { friend: string | null }[]
    >`select public.accept_friend_request(${requestId}, ${me}) as friend`;
    return row?.friend ?? null;
  }

  /** Declines an incoming request or cancels an outgoing one. Returns the other person's id. */
  async removeRequest(requestId: string, me: string): Promise<string | null> {
    const [row] = await this.sql<{ other: string }[]>`
      delete from public.friend_requests where id = ${requestId} and ${me} in (from_user, to_user)
      returning case when from_user = ${me} then to_user else from_user end as other`;
    return row?.other ?? null;
  }

  async unfriend(me: string, other: string): Promise<boolean> {
    const rows = await this.sql`
      delete from public.friendships where user_a = least(${me}::uuid, ${other}::uuid)
        and user_b = greatest(${me}::uuid, ${other}::uuid) returning 1`;
    return rows.length > 0;
  }

  async block(me: string, other: string) {
    await this.sql`select public.block_user(${me}, ${other})`;
  }

  async unblock(me: string, other: string) {
    await this.sql`delete from public.blocks where blocker = ${me} and blocked = ${other}`;
  }

  async blocked(me: string): Promise<PublicProfile[]> {
    const rows = await this.sql<ProfileRow[]>`
      ${this.profileSelect()} join public.blocks b on b.blocked = p.user_id where b.blocker = ${me}
      order by b.created_at desc`;
    return rows.map(toProfile);
  }

  /** Everyone `me` has blocked or been blocked by. */
  async blockedEitherWay(me: string): Promise<Set<string>> {
    const rows = await this.sql<{ id: string }[]>`
      select blocked as id from public.blocks where blocker = ${me}
      union select blocker from public.blocks where blocked = ${me}`;
    return new Set(rows.map((r) => r.id));
  }

  async mute(me: string, other: string) {
    await this.sql`insert into public.mutes (muter, muted) values (${me}, ${other}) on conflict do nothing`;
  }

  async unmute(me: string, other: string) {
    await this.sql`delete from public.mutes where muter = ${me} and muted = ${other}`;
  }

  async muted(me: string): Promise<Set<string>> {
    const rows = await this.sql<{ id: string }[]>`select muted as id from public.mutes where muter = ${me}`;
    return new Set(rows.map((r) => r.id));
  }

  async createReport(r: {
    reporter: string;
    targetUser: string;
    kind: "user" | "message" | "say" | "profile";
    targetId?: string;
    reason: ReportReason;
    note: string;
    context: unknown;
  }): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.reports (reporter, target_user, kind, target_id, reason, note, context)
      values (${r.reporter}, ${r.targetUser}, ${r.kind}, ${r.targetId ?? null}, ${r.reason}, ${r.note},
              ${this.sql.json(r.context as never)})
      returning id`;
    return row!.id;
  }

  async settings(userId: string): Promise<Settings> {
    const [row] = await this.sql<
      { data: unknown }[]
    >`select data from public.settings where user_id = ${userId}`;
    return settingsSchema.parse(row?.data ?? {});
  }

  async saveSettings(userId: string, settings: Settings) {
    await this.sql`
      insert into public.settings (user_id, data) values (${userId}, ${this.sql.json(settings as never)})
      on conflict (user_id) do update set data = excluded.data`;
  }
}
