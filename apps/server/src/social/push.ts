import type { Settings } from "@hearth/shared";
import webpush, { type PushSubscription } from "web-push";
import type { Sql } from "../db";
import type { PresenceService } from "./presence";
import type { SocialRepo } from "./socialRepo";

export type PushKind = "dm" | "group" | "friendRequest" | "letter";

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification should take you. */
  url: string;
  /** Notifications with the same tag replace each other (one per chat). */
  tag: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

type Sender = (sub: PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

/** Whether `now` falls inside the user's quiet hours, in their own time zone. */
export function inQuietHours(s: Settings, now: Date): boolean {
  if (!s.quietHours.enabled) return false;
  let hhmm: string;
  try {
    hhmm = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: s.timeZone,
    }).format(now);
  } catch {
    hhmm = now.toISOString().slice(11, 16);
  }
  const { start, end } = s.quietHours;
  return start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

/** Web Push notifications, sent only when the person isn't connected and wants that kind of notification. */
export class PushService {
  constructor(
    private sql: Sql,
    private social: SocialRepo,
    private presence: PresenceService,
    private vapid: VapidConfig | null,
    private send: Sender = webpush.sendNotification,
    private now: () => Date = () => new Date(),
  ) {}

  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async subscribe(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent: string,
  ) {
    await this.sql`
      insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
      values (${sub.endpoint}, ${userId}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${userAgent.slice(0, 200)})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`;
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this
      .sql`delete from public.push_subscriptions where endpoint = ${endpoint} and user_id = ${userId}`;
  }

  /** Returns how many devices it was sent to (0 when skipped). */
  async notify(userId: string, kind: PushKind, payload: PushPayload): Promise<number> {
    if (!this.vapid) return 0;
    if (await this.presence.isConnected(userId)) return 0;
    const settings = await this.social.settings(userId);
    if (!settings.notifications[kind] || inQuietHours(settings, this.now())) return 0;
    const subs = await this.sql<{ endpoint: string; p256dh: string; auth: string }[]>`
      select endpoint, p256dh, auth from public.push_subscriptions where user_id = ${userId}`;
    let sent = 0;
    for (const s of subs) {
      try {
        await this.send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          {
            vapidDetails: {
              subject: this.vapid.subject,
              publicKey: this.vapid.publicKey,
              privateKey: this.vapid.privateKey,
            },
            TTL: 60 * 60 * 24,
            urgency: kind === "friendRequest" ? "normal" : "high",
            topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
          },
        );
        sent++;
      } catch (e) {
        // The push service says this subscription is gone: forget it.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await this.sql`delete from public.push_subscriptions where endpoint = ${s.endpoint}`;
        else console.warn("push failed", status ?? e);
      }
    }
    return sent;
  }
}
