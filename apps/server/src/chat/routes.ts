import {
  createGroupSchema,
  editMessageSchema,
  receiptsSchema,
  sendMessageSchema,
  updateGroupSchema,
  userIdSchema,
  type ChatMessage,
  type ConversationSummary,
  type ServerEvent,
} from "@hearth/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../auth";
import { userChannel } from "../bus";
import { HttpError } from "../errors";
import { parse } from "../http";
import { rateLimit } from "../ratelimit";
import type { SocialDeps } from "../social/routes";
import { ChatError, toMessage, type ConversationRow } from "./chatRepo";

const CHAT_ERRORS: Record<ChatError["code"], [number, string]> = {
  not_found: [404, "That message is no longer there."],
  forbidden: [403, "You can't do that in this chat."],
  too_late: [409, "Messages can only be edited for 5 minutes."],
  full: [409, "Group chats can have up to 20 people."],
  id_taken: [409, "That message id is already used."],
};

function chatError(e: unknown): never {
  if (e instanceof ChatError) {
    const [status, message] = CHAT_ERRORS[e.code];
    throw new HttpError(status, e.code, message);
  }
  throw e;
}

/** DMs and group chats. Everything is over HTTP (so it works outside the world) plus live events. */
export function chatRoutes(d: SocialDeps): Router {
  const r = Router();
  const authed = requireUser(d.verifyToken);
  const tell = (userId: string, event: ServerEvent) => d.bus.publish(userChannel(userId), event);
  const idParam = (req: Request, name = "id") => parse(z.string().uuid(), req.params[name]);

  /** Loads a conversation the user belongs to, or 404s (never revealing whether it exists). */
  async function mine(conversationId: string, me: string): Promise<ConversationRow> {
    const c = await d.chat.conversation(conversationId);
    if (!c || !(await d.chat.isMember(conversationId, me)))
      throw new HttpError(404, "not_found", "That chat isn't there.");
    return c;
  }

  /** Senders whose messages `me` shouldn't see: anyone blocked either way, plus muted people in groups. */
  async function hiddenSenders(me: string, kind: "dm" | "group" | "all") {
    const hidden = await d.social.blockedEitherWay(me);
    if (kind !== "dm") for (const m of await d.social.muted(me)) hidden.add(m);
    return hidden;
  }

  async function summaries(me: string): Promise<ConversationSummary[]> {
    const rows = await d.chat.list(me, await d.social.blockedEitherWay(me));
    const allMembers = await Promise.all(rows.map((c) => d.chat.members(c.id)));
    const ids = [...new Set(allMembers.flat().map((m) => m.user_id))];
    const [profiles, settings, mySettings] = await Promise.all([
      d.social.profiles(ids),
      Promise.all(ids.map(async (id) => [id, await d.social.settings(id)] as const)).then((e) => new Map(e)),
      d.social.settings(me),
    ]);
    return rows.map((c, i) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      icon: c.icon,
      unread: c.unread,
      myReadSeq: c.my_read_seq,
      muted: c.muted,
      lastMessage: c.last
        ? toMessage({
            ...c.last,
            created_at: new Date(c.last.created_at),
            edited_at: c.last.edited_at && new Date(c.last.edited_at),
            deleted_at: c.last.deleted_at && new Date(c.last.deleted_at),
          })
        : null,
      members: allMembers[i]!.filter((m) => profiles.has(m.user_id)).map((m) => ({
        profile: profiles.get(m.user_id)!,
        deliveredSeq: m.delivered_seq,
        // Read receipts are mutual: hidden if either side turned them off.
        readSeq:
          m.user_id === me || (mySettings.readReceipts && settings.get(m.user_id)?.readReceipts)
            ? m.read_seq
            : null,
      })),
    }));
  }

  async function summary(me: string, id: string) {
    return (await summaries(me)).find((c) => c.id === id)!;
  }

  r.get("/api/conversations", authed, async (req, res) => {
    res.json({ conversations: await summaries(currentUser(req).id) });
  });

  r.post("/api/conversations/dm", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { userId } = parse(userIdSchema, req.body);
    if (!(await d.social.areFriends(me, userId)))
      throw new HttpError(403, "not_friends", "You can only message friends.");
    const id = await d.chat.dm(me, userId);
    res.json(await summary(me, id));
  });

  r.post("/api/conversations/group", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(createGroupSchema, req.body);
    for (const id of body.memberIds) {
      if (!(await d.social.areFriends(me, id)))
        throw new HttpError(403, "not_friends", "You can only add friends to a group.");
    }
    const id = await d.chat.createGroup(me, body.name, body.icon, body.memberIds).catch(chatError);
    for (const m of new Set([me, ...body.memberIds])) tell(m, { type: "conversation", conversationId: id });
    res.json(await summary(me, id));
  });

  r.patch("/api/conversations/:id", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    if (c.kind !== "group") throw new HttpError(400, "not_group", "Only group chats have a name.");
    await d.chat.updateGroup(c.id, parse(updateGroupSchema, req.body));
    for (const m of await d.chat.members(c.id))
      tell(m.user_id, { type: "conversation", conversationId: c.id });
    res.json(await summary(me, c.id));
  });

  r.post("/api/conversations/:id/members", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    const { userId } = parse(userIdSchema, req.body);
    if (c.kind !== "group") throw new HttpError(400, "not_group", "You can't add people to a DM.");
    if (!(await d.social.areFriends(me, userId)))
      throw new HttpError(403, "not_friends", "You can only add friends.");
    await d.chat.addMember(c.id, userId).catch(chatError);
    for (const m of await d.chat.members(c.id))
      tell(m.user_id, { type: "conversation", conversationId: c.id });
    res.json(await summary(me, c.id));
  });

  r.delete("/api/conversations/:id/members/me", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    if (c.kind !== "group") throw new HttpError(400, "not_group", "You can't leave a DM.");
    await d.chat.leave(c.id, me);
    tell(me, { type: "conversation", conversationId: c.id });
    for (const m of await d.chat.members(c.id))
      tell(m.user_id, { type: "conversation", conversationId: c.id });
    res.json({ ok: true });
  });

  r.put("/api/conversations/:id/muted", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    const { muted } = parse(z.object({ muted: z.boolean() }).strict(), req.body);
    await d.chat.setMuted(c.id, me, muted);
    res.json({ ok: true });
  });

  r.get("/api/conversations/:id/messages", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    const q = parse(
      z.object({
        before: z.coerce.number().int().min(0).optional(),
        after: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      req.query,
    );
    const messages = await d.chat.messages(c.id, { ...q, hideSenders: await hiddenSenders(me, c.kind) });
    res.json({ messages });
  });

  r.post("/api/conversations/:id/messages", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    const body = parse(sendMessageSchema, req.body);
    await rateLimit(
      d.store,
      `msg:${me}`,
      20,
      10,
      "You're sending messages very fast. Take a breath and try again.",
    );
    const members = await d.chat.members(c.id);
    if (c.kind === "dm") {
      const other = members.find((m) => m.user_id !== me)?.user_id;
      // DMs are friends-only, and a block closes them in both directions.
      if (!other || !(await d.social.areFriends(me, other))) {
        throw new HttpError(403, "not_friends", "You can only message friends.");
      }
    }
    const { message, created } = await d.chat.send(body.id, c.id, me, body.body).catch(chatError);
    if (created)
      await deliver(
        c,
        members.map((m) => m.user_id),
        message,
        me,
      );
    res.json({ message });
  });

  /** Sends a new message to everyone in the chat who should see it, and pushes to those offline. */
  async function deliver(c: ConversationRow, memberIds: string[], message: ChatMessage, sender: string) {
    const [senderProfile] = (await d.social.profiles([sender])).values();
    for (const m of memberIds) {
      if (m !== sender) {
        const hidden = await hiddenSenders(m, c.kind);
        if (hidden.has(sender)) continue;
      }
      tell(m, { type: "message", message });
      if (m === sender) continue;
      const memberRow = (await d.chat.members(c.id)).find((x) => x.user_id === m);
      if (memberRow?.muted) continue;
      const who = senderProfile?.displayName ?? "A friend";
      void d.push.notify(m, c.kind === "dm" ? "dm" : "group", {
        title: c.kind === "dm" ? who : c.name,
        body: (c.kind === "dm" ? message.body : `${who}: ${message.body}`).slice(0, 120),
        url: `/?chat=${c.id}`,
        tag: `chat-${c.id}`,
      });
    }
  }

  r.patch("/api/messages/:id", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { body } = parse(editMessageSchema, req.body);
    const message = await d.chat.edit(idParam(req), me, body).catch(chatError);
    for (const m of await d.chat.members(message.conversationId))
      tell(m.user_id, { type: "message_updated", message });
    res.json({ message });
  });

  r.delete("/api/messages/:id", authed, async (req, res) => {
    const me = currentUser(req).id;
    const message = await d.chat.delete(idParam(req), me).catch(chatError);
    for (const m of await d.chat.members(message.conversationId))
      tell(m.user_id, { type: "message_updated", message });
    res.json({ message });
  });

  r.post("/api/conversations/:id/receipts", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    const body = parse(receiptsSchema, req.body);
    const row = await d.chat.receipts(c.id, me, body.deliveredSeq, body.readSeq);
    if (!row) throw new HttpError(404, "not_found", "That chat isn't there.");
    const mySettings = await d.social.settings(me);
    for (const m of await d.chat.members(c.id)) {
      if (m.user_id === me) continue;
      const theirs = await d.social.settings(m.user_id);
      const showRead = mySettings.readReceipts && theirs.readReceipts;
      tell(m.user_id, {
        type: "receipt",
        conversationId: c.id,
        userId: me,
        deliveredSeq: row.delivered_seq,
        readSeq: showRead ? row.read_seq : null,
      });
    }
    res.json({ deliveredSeq: row.delivered_seq, readSeq: row.read_seq });
  });

  r.post("/api/conversations/:id/typing", authed, async (req, res) => {
    const me = currentUser(req).id;
    const c = await mine(idParam(req), me);
    // At most one typing signal per second per chat; extra ones are dropped quietly.
    const { count } = await d.store.incr(`typing:${me}:${c.id}`, 1);
    if (count === 1) {
      const hidden = await d.social.blockedEitherWay(me);
      for (const m of await d.chat.members(c.id)) {
        if (m.user_id !== me && !hidden.has(m.user_id))
          tell(m.user_id, { type: "typing", conversationId: c.id, userId: me });
      }
    }
    res.json({ ok: true });
  });

  return r;
}
