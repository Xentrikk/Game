import {
  friendRequestSchema,
  normalizeFriendCode,
  normalizeHandle,
  reportSchema,
  settingsPatchSchema,
  settingsSchema,
  userIdSchema,
  type FriendsResponse,
  type ServerEvent,
} from "@hearth/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { currentUser, type TokenVerifier, requireUser } from "../auth";
import { BLOCKS_CHANNEL, userChannel, type EventBus } from "../bus";
import type { ChatRepo } from "../chat/chatRepo";
import { HttpError } from "../errors";
import { parse } from "../http";
import { rateLimit } from "../ratelimit";
import type { Store } from "../store";
import type { PresenceService } from "./presence";
import type { PushService } from "./push";
import type { SocialRepo } from "./socialRepo";

export interface SocialDeps {
  social: SocialRepo;
  chat: ChatRepo;
  presence: PresenceService;
  push: PushService;
  bus: EventBus;
  store: Store;
  verifyToken: TokenVerifier;
  /** Public URL of the web app, for invite links. */
  appUrl: string;
}

const NOT_FOUND = "No one has that handle or code.";

/** Friends, blocks, mutes, reports, settings, presence and push subscriptions. */
export function socialRoutes(d: SocialDeps): Router {
  const r = Router();
  const authed = requireUser(d.verifyToken);
  const tell = (userId: string, event: ServerEvent) => d.bus.publish(userChannel(userId), event);
  const userParam = (req: Request) => parse(z.string().uuid(), req.params.userId);

  // ---------- Friends ----------

  r.get("/api/friends", authed, async (req, res) => {
    const me = currentUser(req).id;
    const [friends, requests] = await Promise.all([d.social.friends(me), d.social.requests(me)]);
    const body: FriendsResponse = {
      friends: await Promise.all(
        friends.map(async (f) => ({ ...f, presence: await d.presence.presenceOf(f.profile.id) })),
      ),
      ...requests,
    };
    res.json(body);
  });

  r.get("/api/friends/code", authed, async (req, res) => {
    const code = await d.social.friendCode(currentUser(req).id);
    res.json({ code, inviteUrl: `${d.appUrl}/add/${code}` });
  });

  r.post("/api/friends/code/regenerate", authed, async (req, res) => {
    const code = await d.social.regenerateFriendCode(currentUser(req).id);
    res.json({ code, inviteUrl: `${d.appUrl}/add/${code}` });
  });

  /** Look up someone by handle (to add them). People who blocked you, or you them, don't exist. */
  r.get("/api/users/:handle", authed, async (req, res) => {
    const me = currentUser(req).id;
    const profile = await d.social.profileByHandle(normalizeHandle(String(req.params.handle)));
    if (!profile) throw new HttpError(404, "not_found", NOT_FOUND);
    const relationship = await d.social.relationship(me, profile.id);
    if (relationship === "blocked") throw new HttpError(404, "not_found", NOT_FOUND);
    res.json({ profile, relationship });
  });

  r.get("/api/friends/code/:code", authed, async (req, res) => {
    const me = currentUser(req).id;
    const code = normalizeFriendCode(String(req.params.code));
    const id = code && (await d.social.userIdByFriendCode(code));
    if (!id) throw new HttpError(404, "not_found", NOT_FOUND);
    const relationship = await d.social.relationship(me, id);
    if (relationship === "blocked") throw new HttpError(404, "not_found", NOT_FOUND);
    const profile = (await d.social.profiles([id])).get(id)!;
    res.json({ profile, relationship });
  });

  r.post("/api/friends/requests", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(friendRequestSchema, req.body);
    await rateLimit(
      d.store,
      `friend-req:${me}`,
      20,
      3600,
      "That's a lot of friend requests. Try again later.",
    );
    let target: string | null = null;
    if ("handle" in body) target = (await d.social.profileByHandle(normalizeHandle(body.handle)))?.id ?? null;
    else {
      const code = normalizeFriendCode(body.code);
      target = code ? await d.social.userIdByFriendCode(code) : null;
    }
    if (!target) throw new HttpError(404, "not_found", NOT_FOUND);
    if (target === me) throw new HttpError(400, "self", "That's you!");
    const result = await d.social.sendRequest(me, target);
    // A block makes the request look sent without doing anything, so blocking stays private.
    if (result === "ignored") return void res.json({ status: "requested" });
    tell(me, { type: "friends_changed" });
    tell(target, { type: "friends_changed" });
    if (result === "requested") {
      const [meProfile] = (await d.social.profiles([me])).values();
      void d.push.notify(target, "friendRequest", {
        title: "New friend request",
        body: `${meProfile?.displayName ?? "Someone"} (@${meProfile?.handle}) wants to be friends.`,
        url: "/?friends",
        tag: "friend-requests",
      });
    }
    if (result === "accepted") await Promise.all([d.presence.broadcast(me), d.presence.broadcast(target)]);
    res.json({ status: result });
  });

  r.post("/api/friends/requests/:id/accept", authed, async (req, res) => {
    const me = currentUser(req).id;
    const friend = await d.social.acceptRequest(parse(z.string().uuid(), req.params.id), me);
    if (!friend) throw new HttpError(404, "not_found", "That request is no longer there.");
    tell(me, { type: "friends_changed" });
    tell(friend, { type: "friends_changed" });
    await Promise.all([d.presence.broadcast(me), d.presence.broadcast(friend)]);
    res.json({ ok: true });
  });

  r.delete("/api/friends/requests/:id", authed, async (req, res) => {
    const me = currentUser(req).id;
    const other = await d.social.removeRequest(parse(z.string().uuid(), req.params.id), me);
    if (!other) throw new HttpError(404, "not_found", "That request is no longer there.");
    tell(me, { type: "friends_changed" });
    tell(other, { type: "friends_changed" });
    res.json({ ok: true });
  });

  r.delete("/api/friends/:userId", authed, async (req, res) => {
    const me = currentUser(req).id;
    const other = userParam(req);
    if (await d.social.unfriend(me, other)) {
      tell(me, { type: "friends_changed" });
      tell(other, { type: "friends_changed" });
    }
    res.json({ ok: true });
  });

  // ---------- Blocks and mutes ----------

  r.get("/api/blocks", authed, async (req, res) => {
    res.json({ blocked: await d.social.blocked(currentUser(req).id) });
  });

  r.post("/api/blocks", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { userId } = parse(userIdSchema, req.body);
    if (userId === me) throw new HttpError(400, "self", "You can't block yourself.");
    await d.social.block(me, userId);
    // Only the blocker's own lists refresh; the blocked person is not told.
    tell(me, { type: "friends_changed" });
    d.bus.publish(BLOCKS_CHANNEL, { blocker: me, blocked: userId });
    res.json({ ok: true });
  });

  r.delete("/api/blocks/:userId", authed, async (req, res) => {
    const me = currentUser(req).id;
    const other = userParam(req);
    await d.social.unblock(me, other);
    d.bus.publish(BLOCKS_CHANNEL, { unblocker: me, unblocked: other });
    res.json({ ok: true });
  });

  r.get("/api/mutes", authed, async (req, res) => {
    const me = currentUser(req).id;
    res.json({ muted: [...(await d.social.muted(me))] });
  });

  r.post("/api/mutes", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { userId } = parse(userIdSchema, req.body);
    await d.social.mute(me, userId);
    d.bus.publish(BLOCKS_CHANNEL, { muter: me, muted: userId });
    res.json({ ok: true });
  });

  r.delete("/api/mutes/:userId", authed, async (req, res) => {
    const me = currentUser(req).id;
    const other = userParam(req);
    await d.social.unmute(me, other);
    d.bus.publish(BLOCKS_CHANNEL, { unmuter: me, unmuted: other });
    res.json({ ok: true });
  });

  // ---------- Reports ----------

  r.post("/api/reports", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(reportSchema, req.body);
    await rateLimit(
      d.store,
      `report:${me}`,
      10,
      3600,
      "You've sent a lot of reports. Our team will look at them soon.",
    );
    let context: unknown = {};
    if (body.kind === "message") {
      if (!body.targetId) throw new HttpError(400, "invalid_request", "Which message?");
      const ctx = await d.chat.context(body.targetId);
      if (
        !ctx ||
        !(await d.chat.isMember(ctx.target.conversationId, me)) ||
        ctx.target.senderId !== body.targetUserId
      ) {
        throw new HttpError(404, "not_found", "That message is no longer there.");
      }
      context = ctx;
    } else {
      context = { profile: (await d.social.profiles([body.targetUserId])).get(body.targetUserId) ?? null };
    }
    const id = await d.social.createReport({ reporter: me, targetUser: body.targetUserId, ...body, context });
    res.json({ id });
  });

  // ---------- Settings and presence ----------

  r.get("/api/settings", authed, async (req, res) => {
    res.json(await d.social.settings(currentUser(req).id));
  });

  r.patch("/api/settings", authed, async (req, res) => {
    const me = currentUser(req).id;
    const patch = parse(settingsPatchSchema, req.body);
    const current = await d.social.settings(me);
    const next = settingsSchema.parse({
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...patch.notifications },
      quietHours: { ...current.quietHours, ...patch.quietHours },
    });
    await d.social.saveSettings(me, next);
    if (next.presence !== current.presence || next.shareLocation !== current.shareLocation)
      await d.presence.broadcast(me);
    res.json(next);
  });

  r.post("/api/presence", authed, async (req, res) => {
    const { away } = parse(z.object({ away: z.boolean() }).strict(), req.body);
    await d.presence.setAway(currentUser(req).id, away);
    res.json({ ok: true });
  });

  // ---------- Push subscriptions ----------

  r.get("/api/push/key", (_req, res) => {
    res.json({ publicKey: d.push.publicKey });
  });

  const subscription = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  });

  r.post("/api/push/subscriptions", authed, async (req, res) => {
    const sub = parse(subscription, req.body);
    await d.push.subscribe(currentUser(req).id, sub, String(req.header("user-agent") ?? ""));
    res.json({ ok: true });
  });

  r.delete("/api/push/subscriptions", authed, async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().url() }), req.body);
    await d.push.unsubscribe(currentUser(req).id, endpoint);
    res.json({ ok: true });
  });

  return r;
}
