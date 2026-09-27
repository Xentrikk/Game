import { requireItemDefinition, type FurniturePlacement, type HomeAccess } from "@hearth/shared";
import type { Sql } from "../db";
import { EconomyError, mapEconomyPgError } from "./errors";

interface FurnitureRow {
  id: string;
  item_id: string;
  x: number;
  y: number;
}
const toFurniture = (r: FurnitureRow): FurniturePlacement => ({
  id: r.id,
  itemId: r.item_id,
  x: r.x,
  y: r.y,
});

/** Private homes: who can enter, the guest list for "Invite only", and placed furniture. */
export class HomeRepo {
  constructor(private sql: Sql) {}

  async getAccess(ownerId: string): Promise<HomeAccess> {
    const [row] = await this.sql<
      { access: HomeAccess }[]
    >`select access from public.homes where user_id = ${ownerId}`;
    return row?.access ?? "friends";
  }

  async setAccess(ownerId: string, access: HomeAccess): Promise<void> {
    await this.sql`
      insert into public.homes (user_id, access) values (${ownerId}, ${access})
      on conflict (user_id) do update set access = excluded.access, updated_at = now()`;
  }

  async guestIds(ownerId: string): Promise<string[]> {
    const rows = await this.sql<{ guest_id: string }[]>`
      select guest_id from public.home_guests where home_owner = ${ownerId} order by added_at`;
    return rows.map((r) => r.guest_id);
  }

  async isGuest(ownerId: string, guestId: string): Promise<boolean> {
    const rows = await this.sql`
      select 1 from public.home_guests where home_owner = ${ownerId} and guest_id = ${guestId}`;
    return rows.length > 0;
  }

  async addGuest(ownerId: string, guestId: string): Promise<void> {
    await this.sql`insert into public.homes (user_id) values (${ownerId}) on conflict do nothing`;
    await this.sql`
      insert into public.home_guests (home_owner, guest_id) values (${ownerId}, ${guestId}) on conflict do nothing`;
  }

  async removeGuest(ownerId: string, guestId: string): Promise<void> {
    await this.sql`delete from public.home_guests where home_owner = ${ownerId} and guest_id = ${guestId}`;
  }

  /** Whether `visitorId` may enter `ownerId`'s home right now. The owner can always enter their own. */
  async canEnter(
    ownerId: string,
    visitorId: string,
    isFriend: boolean,
    isBlocked: boolean,
  ): Promise<boolean> {
    if (visitorId === ownerId) return true;
    if (isBlocked) return false;
    const access = await this.getAccess(ownerId);
    if (access === "closed") return false;
    if (access === "friends") return isFriend;
    return this.isGuest(ownerId, visitorId);
  }

  async furniture(ownerId: string): Promise<FurniturePlacement[]> {
    const rows = await this.sql<FurnitureRow[]>`
      select id, item_id, x, y from public.home_furniture where home_owner = ${ownerId} order by placed_at`;
    return rows.map(toFurniture);
  }

  /** Places one unit of `itemId` from the owner's inventory onto the grid. */
  async place(ownerId: string, itemId: string, x: number, y: number): Promise<FurniturePlacement> {
    const def = requireItemDefinition(itemId);
    if (def.category !== "furniture") throw new EconomyError("not_furniture");
    return this.sql.begin(async (tx) => {
      await tx`insert into public.homes (user_id) values (${ownerId}) on conflict do nothing`;
      try {
        await tx`select public.remove_items(${ownerId}, ${itemId}, 1)`;
        const [row] = await tx<FurnitureRow[]>`
          insert into public.home_furniture (home_owner, item_id, x, y) values (${ownerId}, ${itemId}, ${x}, ${y})
          returning id, item_id, x, y`;
        return toFurniture(row!);
      } catch (e) {
        mapEconomyPgError(e);
      }
    });
  }

  /** Removes a placed item and returns it to the owner's inventory. */
  async remove(ownerId: string, furnitureId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [row] = await tx<FurnitureRow[]>`
        delete from public.home_furniture where id = ${furnitureId} and home_owner = ${ownerId}
        returning id, item_id, x, y`;
      if (!row) return;
      const def = requireItemDefinition(row.item_id);
      await tx`select public.grant_item(${ownerId}, ${row.item_id}, 1, ${def.stackable})`;
    });
  }
}
