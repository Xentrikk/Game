import type { ServerEvent } from "@hearth/shared";
import { env } from "../env";
import { supabase } from "../supabase";

export type StreamEvent = ServerEvent | { type: "connected" } | { type: "disconnected" };
type Listener = (e: StreamEvent) => void;

const IDLE_MS = 5 * 60 * 1000;

/**
 * Reads the live event stream (GET /api/events) and reconnects with backoff when it drops.
 * On every (re)connect it emits "connected", so the app can fetch anything it missed.
 * It also reports "away" after five idle minutes.
 */
export class EventStream {
  private listeners = new Set<Listener>();
  private controller?: AbortController;
  private stopped = false;
  private attempt = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private away = false;

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: StreamEvent) {
    for (const l of this.listeners) l(e);
  }

  start() {
    this.stopped = false;
    void this.loop();
    for (const ev of ["pointerdown", "keydown", "visibilitychange"])
      window.addEventListener(ev, this.onActivity);
    this.onActivity();
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    clearTimeout(this.idleTimer);
    for (const ev of ["pointerdown", "keydown", "visibilitychange"])
      window.removeEventListener(ev, this.onActivity);
  }

  private onActivity = () => {
    clearTimeout(this.idleTimer);
    if (this.away && document.visibilityState === "visible") {
      this.away = false;
      void this.postAway(false);
    }
    this.idleTimer = setTimeout(() => {
      this.away = true;
      void this.postAway(true);
    }, IDLE_MS);
  };

  private async postAway(away: boolean) {
    const { api } = await import("../api");
    await api.setAway(away).catch(() => undefined);
  }

  private async loop() {
    while (!this.stopped) {
      try {
        await this.connectOnce();
        this.attempt = 0;
      } catch {
        /* fall through to the retry */
      }
      if (this.stopped) return;
      this.emit({ type: "disconnected" });
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++) * (0.75 + Math.random() / 2);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async connectOnce() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("signed out");
    this.controller = new AbortController();
    const res = await fetch(`${env.apiUrl}/api/events`, {
      headers: { authorization: `Bearer ${data.session.access_token}` },
      signal: this.controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (!chunk.startsWith("data: ")) continue;
        const event = JSON.parse(chunk.slice(6)) as ServerEvent;
        this.emit(event.type === "hello" ? { type: "connected" } : event);
      }
    }
  }
}
