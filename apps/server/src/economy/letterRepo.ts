import { DEFAULT_STATIONERY_ID, requireItemDefinition, type ItemStack } from "@hearth/shared";
import type { Sql } from "../db";
import { EconomyError, mapEconomyPgError } from "./errors";

export interface LetterRow {
  id: string;
  fromUserId: string | null;
  toUserId: string;
  subject: string;
  body: string;
  stationeryId: string;
  coins: number;
  items: ItemStack;
  sentAt: string;
  readAt: string | null;
  claimedAt: string | null;
}

interface RawLetter {
  id: string;
  from_user: string | null;
  to_user: string;
  subject: string;
  body: string;
  stationery_id: string;
  coins: string;
  sent_at: Date;
  read_at: Date | null;
  claimed_at: Date | null;
}
interface RawAttachment {
  letter_id: string;
  item_id: string;
  quantity: number;
}

function toLetter(r: RawLetter, items: ItemStack): LetterRow {
  return {
    id: r.id,
    fromUserId: r.from_user,
    toUserId: r.to_user,
    subject: r.subject,
    body: r.body,
    stationeryId: r.stationery_id,
    coins: Number(r.coins),
    items,
    sentAt: r.sent_at.toISOString(),
    readAt: r.read_at?.toISOString() ?? null,
    claimedAt: r.claimed_at?.toISOString() ?? null,
  };
}

/** Letters, delivered to the recipient's mailbox. Attachments are how gifting works (PROMPT.md 7.1, 9.3). */
export class LetterRepo {
  constructor(private sql: Sql) {}

  private async attachmentsFor(letterIds: string[]): Promise<Map<string, ItemStack>> {
    if (!letterIds.length) return new Map();
    const rows = await this.sql<RawAttachment[]>`
      select letter_id, item_id, quantity from public.letter_attachments where letter_id = any(${letterIds}::uuid[])`;
    const map = new Map<string, ItemStack>();
    for (const r of rows)
      map.set(r.letter_id, [...(map.get(r.letter_id) ?? []), { itemId: r.item_id, quantity: r.quantity }]);
    return map;
  }

  async inbox(userId: string, limit = 50): Promise<LetterRow[]> {
    const rows = await this.sql<RawLetter[]>`
      select * from public.letters where to_user = ${userId} order by sent_at desc limit ${limit}`;
    const attachments = await this.attachmentsFor(rows.map((r) => r.id));
    return rows.map((r) => toLetter(r, attachments.get(r.id) ?? []));
  }

  async sent(userId: string, limit = 50): Promise<LetterRow[]> {
    const rows = await this.sql<RawLetter[]>`
      select * from public.letters where from_user = ${userId} order by sent_at desc limit ${limit}`;
    const attachments = await this.attachmentsFor(rows.map((r) => r.id));
    return rows.map((r) => toLetter(r, attachments.get(r.id) ?? []));
  }

  /** True if the mailbox has anything unclaimed — used to raise the mailbox flag. */
  async hasUnclaimed(userId: string): Promise<boolean> {
    const rows = await this
      .sql`select 1 from public.letters where to_user = ${userId} and claimed_at is null limit 1`;
    return rows.length > 0;
  }

  async get(letterId: string): Promise<LetterRow | null> {
    const [row] = await this.sql<RawLetter[]>`select * from public.letters where id = ${letterId}`;
    if (!row) return null;
    const attachments = await this.attachmentsFor([letterId]);
    return toLetter(row, attachments.get(letterId) ?? []);
  }

  async markRead(letterId: string, userId: string): Promise<void> {
    await this.sql`
      update public.letters set read_at = coalesce(read_at, now())
      where id = ${letterId} and to_user = ${userId}`;
  }

  /**
   * Sends a letter, escrowing any attached items and coins out of the sender's own holdings in the same
   * transaction that creates it (PROMPT.md 9.3's "same transaction guarantees", applied to gifting).
   */
  async send(opts: {
    fromUserId: string;
    toUserId: string;
    subject: string;
    body: string;
    stationeryId: string;
    items: ItemStack;
    coins: number;
  }): Promise<LetterRow> {
    if (opts.stationeryId !== DEFAULT_STATIONERY_ID) {
      const [owned] = await this.sql<{ n: number }[]>`
        select count(*)::int as n from public.inventory_items where owner_id = ${opts.fromUserId} and item_id = ${opts.stationeryId}`;
      if (!owned || owned.n === 0) throw new EconomyError("stationery_not_owned");
    }
    for (const item of opts.items) {
      const def = requireItemDefinition(item.itemId);
      if (!def.tradeable) throw new EconomyError("not_tradeable");
      if (item.quantity > def.maxStack) throw new EconomyError("exceeds_max_stack");
    }

    return this.sql.begin(async (tx) => {
      const [row] = await tx<RawLetter[]>`
        insert into public.letters (from_user, to_user, subject, body, stationery_id, coins)
        values (${opts.fromUserId}, ${opts.toUserId}, ${opts.subject}, ${opts.body}, ${opts.stationeryId}, ${opts.coins})
        returning *`;
      try {
        for (const item of opts.items) {
          await tx`select public.remove_items(${opts.fromUserId}, ${item.itemId}, ${item.quantity})`;
          await tx`insert into public.letter_attachments (letter_id, item_id, quantity) values (${row!.id}, ${item.itemId}, ${item.quantity})`;
        }
        if (opts.coins > 0)
          await tx`select public.adjust_coins(${opts.fromUserId}, ${-opts.coins}, 'letter_sent', ${row!.id})`;
      } catch (e) {
        mapEconomyPgError(e);
      }
      return toLetter(row!, opts.items);
    });
  }

  /**
   * Grants the attachments and coins to the recipient and marks the letter claimed. Calling this again
   * on an already-claimed letter is a no-op that returns the same letter (never grants twice).
   */
  async claim(letterId: string, userId: string): Promise<LetterRow> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<RawLetter[]>`
        select * from public.letters where id = ${letterId} and to_user = ${userId} for update`;
      if (!row) throw new EconomyError("letter_not_found");
      const attachments = (
        await tx<RawAttachment[]>`
        select letter_id, item_id, quantity from public.letter_attachments where letter_id = ${letterId}`
      ).map((a) => ({
        itemId: a.item_id,
        quantity: a.quantity,
      }));
      if (row.claimed_at) return toLetter(row, attachments);

      for (const item of attachments) {
        const def = requireItemDefinition(item.itemId);
        await tx`select public.grant_item(${userId}, ${item.itemId}, ${item.quantity}, ${def.stackable})`;
      }
      if (Number(row.coins) > 0)
        await tx`select public.adjust_coins(${userId}, ${Number(row.coins)}, 'letter_claimed', ${letterId})`;
      const [updated] = await tx<RawLetter[]>`
        update public.letters set claimed_at = now(), read_at = coalesce(read_at, now())
        where id = ${letterId} returning *`;
      return toLetter(updated!, attachments);
    });
  }
}
