import { EDIT_WINDOW_MS, GROUP_MAX_MEMBERS, type ChatMessage } from "@hearth/shared";
import type { Sql } from "../db";

interface MessageRow {
  id: string;
  seq: string | number;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

export function toMessage(r: MessageRow): ChatMessage {
  const deleted = !!r.deleted_at;
  return {
    id: r.id,
    seq: Number(r.seq),
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: deleted ? "" : r.body,
    createdAt: r.created_at.toISOString(),
    editedAt: r.edited_at?.toISOString() ?? null,
    deleted,
  };
}

export class ChatError extends Error {
  constructor(public code: "not_found" | "forbidden" | "too_late" | "full" | "id_taken") {
    super(code);
  }
}

export interface ConversationRow {
  id: string;
  kind: "dm" | "group";
  name: string;
  icon: string;
  last_seq: number;
}

export interface MemberRow {
  conversation_id: string;
  user_id: string;
  delivered_seq: number;
  read_seq: number;
  muted: boolean;
}

export class ChatRepo {
  constructor(private sql: Sql) {}

  async conversation(id: string): Promise<ConversationRow | null> {
    const [row] = await this.sql<ConversationRow[]>`
      select id, kind, name, icon, last_seq::int as last_seq from public.conversations where id = ${id}`;
    return row ?? null;
  }

  async members(conversationId: string): Promise<MemberRow[]> {
    return this.sql<MemberRow[]>`
      select conversation_id, user_id, delivered_seq::int as delivered_seq, read_seq::int as read_seq, muted
      from public.conversation_members where conversation_id = ${conversationId}`;
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const rows = await this.sql`
      select 1 from public.conversation_members where conversation_id = ${conversationId} and user_id = ${userId}`;
    return rows.length > 0;
  }

  /** The one DM between two people, created on first use. */
  async dm(a: string, b: string): Promise<string> {
    const key = [a, b].sort().join(":");
    return this.sql.begin(async (tx) => {
      const [existing] = await tx<
        { id: string }[]
      >`select id from public.conversations where dm_key = ${key}`;
      if (existing) return existing.id;
      const [created] = await tx<{ id: string }[]>`
        insert into public.conversations (kind, dm_key, created_by) values ('dm', ${key}, ${a})
        on conflict (dm_key) do nothing returning id`;
      // Another request may have created it at the same moment.
      const id =
        created?.id ??
        (await tx<{ id: string }[]>`select id from public.conversations where dm_key = ${key}`)[0]!.id;
      await tx`
        insert into public.conversation_members (conversation_id, user_id)
        values (${id}, ${a}), (${id}, ${b}) on conflict do nothing`;
      return id;
    });
  }

  async createGroup(creator: string, name: string, icon: string, memberIds: string[]): Promise<string> {
    const everyone = [...new Set([creator, ...memberIds])];
    if (everyone.length > GROUP_MAX_MEMBERS) throw new ChatError("full");
    return this.sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into public.conversations (kind, name, icon, created_by) values ('group', ${name}, ${icon}, ${creator})
        returning id`;
      for (const u of everyone)
        await tx`insert into public.conversation_members (conversation_id, user_id) values (${row!.id}, ${u})`;
      return row!.id;
    });
  }

  async updateGroup(id: string, patch: { name?: string; icon?: string }) {
    await this.sql`
      update public.conversations set name = coalesce(${patch.name ?? null}, name), icon = coalesce(${patch.icon ?? null}, icon)
      where id = ${id} and kind = 'group'`;
  }

  async addMember(id: string, userId: string) {
    await this.sql.begin(async (tx) => {
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.conversation_members where conversation_id = ${id}`;
      if (count!.n >= GROUP_MAX_MEMBERS) throw new ChatError("full");
      await tx`insert into public.conversation_members (conversation_id, user_id) values (${id}, ${userId}) on conflict do nothing`;
    });
  }

  async leave(id: string, userId: string) {
    await this
      .sql`delete from public.conversation_members where conversation_id = ${id} and user_id = ${userId}`;
  }

  async setMuted(id: string, userId: string, muted: boolean) {
    await this.sql`
      update public.conversation_members set muted = ${muted} where conversation_id = ${id} and user_id = ${userId}`;
  }

  /** Idempotent: sending the same id twice returns the original message. */
  async send(
    id: string,
    conversationId: string,
    senderId: string,
    body: string,
  ): Promise<{ message: ChatMessage; created: boolean }> {
    try {
      const before = await this.sql`select 1 from public.messages where id = ${id}`;
      const [row] = await this.sql<
        MessageRow[]
      >`select * from public.send_message(${id}, ${conversationId}, ${senderId}, ${body})`;
      return { message: toMessage(row!), created: before.length === 0 };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "23505") throw new ChatError("id_taken");
      if (code === "42501") throw new ChatError("forbidden");
      throw e;
    }
  }

  /** Messages in seq order. `before` pages back through history; `after` catches up after a reconnect. */
  async messages(
    conversationId: string,
    opts: { before?: number; after?: number; limit: number; hideSenders?: Set<string> },
  ): Promise<ChatMessage[]> {
    const hidden = [...(opts.hideSenders ?? [])];
    const rows =
      opts.after !== undefined
        ? await this.sql<MessageRow[]>`
          select * from public.messages where conversation_id = ${conversationId} and seq > ${opts.after}
            and (sender_id is null or not (sender_id = any(${hidden}::uuid[])))
          order by seq asc limit ${opts.limit}`
        : (
            await this.sql<MessageRow[]>`
          select * from public.messages where conversation_id = ${conversationId}
            and seq < ${opts.before ?? Number.MAX_SAFE_INTEGER}
            and (sender_id is null or not (sender_id = any(${hidden}::uuid[])))
          order by seq desc limit ${opts.limit}`
          ).reverse();
    return rows.map(toMessage);
  }

  async message(id: string): Promise<ChatMessage | null> {
    const [row] = await this.sql<MessageRow[]>`select * from public.messages where id = ${id}`;
    return row ? toMessage(row) : null;
  }

  async edit(id: string, userId: string, body: string, now = Date.now()): Promise<ChatMessage> {
    const [row] = await this.sql<MessageRow[]>`select * from public.messages where id = ${id}`;
    if (!row || row.deleted_at) throw new ChatError("not_found");
    if (row.sender_id !== userId) throw new ChatError("forbidden");
    if (now - row.created_at.getTime() > EDIT_WINDOW_MS) throw new ChatError("too_late");
    const [updated] = await this.sql<MessageRow[]>`
      update public.messages set body = ${body}, edited_at = now() where id = ${id} returning *`;
    return toMessage(updated!);
  }

  /**
   * Deletes a message for everyone in the chat. The text is kept (hidden) so a report can still show
   * moderators what was said; see docs/decisions.md for retention.
   */
  async delete(id: string, userId: string): Promise<ChatMessage> {
    const [row] = await this.sql<MessageRow[]>`
      update public.messages set deleted_at = coalesce(deleted_at, now())
      where id = ${id} and sender_id = ${userId} returning *`;
    if (!row) throw new ChatError((await this.message(id)) ? "forbidden" : "not_found");
    return toMessage(row);
  }

  /** Moves a member's delivered/read positions forward (never back, never past the last message). */
  async receipts(
    conversationId: string,
    userId: string,
    delivered?: number,
    read?: number,
  ): Promise<MemberRow | null> {
    const [row] = await this.sql<MemberRow[]>`
      update public.conversation_members m set
        read_seq = greatest(m.read_seq, least(coalesce(${read ?? null}::bigint, 0), c.last_seq)),
        delivered_seq = greatest(m.delivered_seq, least(greatest(coalesce(${delivered ?? null}::bigint, 0), coalesce(${read ?? null}::bigint, 0)), c.last_seq))
      from public.conversations c
      where m.conversation_id = ${conversationId} and m.user_id = ${userId} and c.id = m.conversation_id
      returning m.conversation_id, m.user_id, m.delivered_seq::int as delivered_seq, m.read_seq::int as read_seq, m.muted`;
    return row ?? null;
  }

  /** All conversations for a user, newest activity first, with the last message and unread count. */
  async list(userId: string, hideSenders: Set<string>) {
    const hidden = [...hideSenders];
    return this.sql<
      (ConversationRow & { my_read_seq: number; muted: boolean; unread: number; last: MessageRow | null })[]
    >`
      select c.id, c.kind, c.name, c.icon, c.last_seq::int as last_seq, m.read_seq::int as my_read_seq, m.muted,
        (select count(*)::int from public.messages x
          where x.conversation_id = c.id and x.seq > m.read_seq and x.sender_id is distinct from ${userId}
            and x.deleted_at is null and not (coalesce(x.sender_id = any(${hidden}::uuid[]), false))) as unread,
        (select row_to_json(l) from (
          select * from public.messages x where x.conversation_id = c.id
            and not (coalesce(x.sender_id = any(${hidden}::uuid[]), false))
          order by x.seq desc limit 1) l) as last
      from public.conversation_members m join public.conversations c on c.id = m.conversation_id
      where m.user_id = ${userId}
      order by c.last_seq desc, c.created_at desc`;
  }

  /** The reported message with up to 10 messages either side, for moderators. */
  async context(messageId: string) {
    const target = await this.message(messageId);
    if (!target) return null;
    const around = await this.sql<MessageRow[]>`
      (select * from public.messages where conversation_id = ${target.conversationId} and seq < ${target.seq} order by seq desc limit 10)
      union all
      (select * from public.messages where conversation_id = ${target.conversationId} and seq >= ${target.seq} order by seq asc limit 11)
      order by seq`;
    return {
      target,
      messages: around.map((r) => ({ ...toMessage(r), body: r.body, deleted: !!r.deleted_at })),
    };
  }
}
