import type { ServerEvent } from "@hearth/shared";
import { Router } from "express";
import { currentUser, requireUser, type TokenVerifier } from "./auth";
import { userChannel, type EventBus } from "./bus";
import type { PresenceService } from "./social/presence";

const HEARTBEAT_MS = 30_000;

/**
 * GET /api/events: a server-sent event stream of everything addressed to the signed-in user.
 * Clients read it with fetch (so the Authorization header works) and reconnect with backoff.
 * While it's open the user counts as online.
 */
export function eventRoutes(d: {
  bus: EventBus;
  presence: PresenceService;
  verifyToken: TokenVerifier;
}): Router {
  const r = Router();
  r.get("/api/events", requireUser(d.verifyToken), async (req, res) => {
    const me = currentUser(req).id;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: "hello" } satisfies ServerEvent);
    const unsubscribe = d.bus.subscribe(userChannel(me), send);
    const disconnect = await d.presence.connect(me);
    const heartbeat = setInterval(() => {
      res.write(": keep-alive\n\n");
      void d.presence.heartbeat(me);
    }, HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      void disconnect();
    });
  });
  return r;
}
