import { CLOSE_REPLACED, EMOTES, SAY_MAX, VIEW_H, VIEW_W, bubbleMs, type Emote } from "@hearth/shared";
import Phaser from "phaser";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DialogueBox } from "../components/DialogueBox";
import type { WorldConnection } from "../game/connection";
import { InputState } from "../game/input";
import { ScreenPipeline } from "../game/pocket";
import { TouchPad } from "../game/TouchPad";
import { WorldScene, type WorldUi } from "../game/WorldScene";
import { SocialUiContext, useSocialOptional } from "../social/contexts";
import { EMOTE_LABELS, EmoteIcon } from "../social/emotes";

type Status = "joining" | "connected" | "reconnecting" | "replaced" | "left" | "error";

const POCKET_KEY = "hearth.pocket";
function readPocket(): boolean {
  try {
    return localStorage.getItem(POCKET_KEY) === "1";
  } catch {
    return false;
  }
}
function writePocket(on: boolean) {
  try {
    localStorage.setItem(POCKET_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable; the setting just won't persist */
  }
}

const params = new URLSearchParams(location.search);
const hourOverride = import.meta.env.DEV && params.has("hour") ? Number(params.get("hour")) : undefined;
const forceTouch = params.get("touch") === "1";
const LOG_MAX = 50;

function useCoarsePointer(): boolean {
  const [coarse] = useState(
    () => forceTouch || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches),
  );
  return coarse;
}

interface Props {
  onExit: () => void;
  /** Joins the world: the real game server, or the offline demo. `roomId` joins a specific instance. */
  connect: (opts?: { roomId?: string }) => Promise<WorldConnection>;
  /** Optional one-off message shown when entering (the demo uses it to explain itself). */
  notice?: { pages: string[]; speaker?: string };
}

/** The Town Square. With a signed-in social store it also offers chats, friends and player cards. */
export default function World(props: Props) {
  const social = useContext(SocialUiContext);
  const [target, setTarget] = useState<{ roomId?: string; n: number }>({ n: 0 });
  // While the world is open, "Go to friend" rejoins at that friend's Town Square instance.
  useEffect(() => {
    social?.setGoTo((roomId) => setTarget((t) => ({ roomId, n: t.n + 1 })));
    return () => social?.setGoTo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <WorldScreen {...props} target={target} onRetry={() => setTarget((t) => ({ n: t.n + 1 }))} />;
}

interface Bubble {
  key: number;
  sessionId: string;
  text: string;
  until: number;
}
interface FloatingEmote {
  key: number;
  sessionId: string;
  emote: Emote;
}

function WorldScreen({
  onExit,
  connect,
  notice,
  target,
  onRetry,
}: Props & { target: { roomId?: string; n: number }; onRetry: () => void }) {
  const socialUi = useContext(SocialUiContext);
  const conversations = useSocialOptional((s) => s.conversations);
  const unread = conversations?.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0) ?? 0;

  const [status, setStatus] = useState<Status>("joining");
  const [error, setError] = useState("");
  const [dialogue, setDialogue] = useState<{ pages: string[]; page: number; speaker?: string } | null>(null);
  const [reveal, setReveal] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pocket, setPocketState] = useState(readPocket);
  const [running, setRunning] = useState(false);
  const [sayOpen, setSayOpen] = useState(false);
  const [sayText, setSayText] = useState("");
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const [log, setLog] = useState<{ key: number; name: string; text: string }[]>([]);
  const touch = useCoarsePointer();

  const input = useMemo(() => new InputState(), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sayRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const roomRef = useRef<WorldConnection | null>(null);
  const dialogueRef = useRef(dialogue);
  const typingRef = useRef(false);
  const menuRef = useRef(menuOpen);
  const keyRef = useRef(0);
  dialogueRef.current = dialogue;
  menuRef.current = menuOpen;

  const nameOf = useCallback((sessionId: string) => {
    const p = roomRef.current?.players().find(([id]) => id === sessionId)?.[1];
    return p ? { name: p.name || p.handle, handle: p.handle } : null;
  }, []);

  const ui: WorldUi = useMemo(
    () => ({
      input,
      isDialogueOpen: () => !!dialogueRef.current || menuRef.current,
      openDialogue: (pages, speaker) => {
        input.releaseAll();
        setDialogue({ pages, page: 0, speaker });
      },
      advanceDialogue: () => {
        if (menuRef.current) return;
        if (typingRef.current) return setReveal((n) => n + 1);
        setDialogue((d) => (d && d.page + 1 < d.pages.length ? { ...d, page: d.page + 1 } : null));
      },
      onPlayerTap: (sessionId) => {
        const who = nameOf(sessionId);
        if (!who) return;
        if (!socialUi) return void setDialogue({ pages: [`That's ${who.name}.`], page: 0 });
        socialUi.openProfile(who.handle, (reason, note) =>
          roomRef.current!.reportSay(sessionId, reason, note),
        );
      },
    }),
    [input, nameOf, socialUi],
  );

  // Join the Town Square and start Phaser.
  useEffect(() => {
    let cancelled = false;
    let game: Phaser.Game | undefined;
    setStatus("joining");
    // Join on the next tick: React's StrictMode mounts effects twice in development, and two
    // overlapping joins would make the second one "replace" the first.
    const start = setTimeout(
      () =>
        void connect({ roomId: target.roomId })
          .then((room) => {
            if (cancelled) return void room.leave();
            roomRef.current = room;
            room.onDrop(() => setStatus("reconnecting"));
            room.onReconnect(() => setStatus("connected"));
            room.onLeave((code) => setStatus(code === CLOSE_REPLACED ? "replaced" : "left"));
            room.onSay(({ sessionId, text }) => {
              const key = ++keyRef.current;
              const until = Date.now() + bubbleMs(text);
              setBubbles((b) => [
                ...b.filter((x) => x.sessionId !== sessionId),
                { key, sessionId, text, until },
              ]);
              setTimeout(() => setBubbles((b) => b.filter((x) => x.key !== key)), bubbleMs(text));
              const who = nameOf(sessionId);
              setLog((l) => [...l.slice(-(LOG_MAX - 1)), { key, name: who?.name ?? "Someone", text }]);
            });
            room.onEmote(({ sessionId, emote }) => {
              const key = ++keyRef.current;
              setEmotes((e) => [...e, { key, sessionId, emote }]);
              setTimeout(() => setEmotes((e) => e.filter((x) => x.key !== key)), 2000);
            });
            game = new Phaser.Game({
              type: Phaser.AUTO,
              parent: hostRef.current!,
              width: VIEW_W,
              height: VIEW_H,
              pixelArt: true,
              roundPixels: true,
              backgroundColor: "#1a1420",
              banner: false,
              audio: { noAudio: true },
              scale: { mode: Phaser.Scale.NONE },
              pipeline: { ScreenPipeline } as unknown as Phaser.Types.Core.PipelineConfig,
            });
            game.scene.add("world", WorldScene, true, { conn: room, ui, pocket: readPocket(), hourOverride });
            game.events.once(Phaser.Core.Events.READY, () => {
              // Scenes only exist once Phaser has booted.
              sceneRef.current = game?.scene.getScene("world") as WorldScene;
              fit();
            });
            setStatus("connected");
            if (notice) setDialogue({ pages: notice.pages, page: 0, speaker: notice.speaker });
          })
          .catch((e: unknown) => {
            setError(e instanceof Error ? e.message : "Couldn't reach the Town Square.");
            setStatus("error");
          }),
    );

    // Scale to the largest whole number of *device* pixels that fits, so pixels stay perfectly square.
    const fit = () => {
      const screen = screenRef.current;
      if (!game || !screen) return;
      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(
        1,
        Math.floor(Math.min((screen.clientWidth * dpr) / VIEW_W, (screen.clientHeight * dpr) / VIEW_H)),
      );
      game.scale.setZoom(k / dpr);
      // Centre on whole device pixels: a half-pixel offset would make the browser resample and blur the art.
      const frame = frameRef.current;
      if (frame) {
        frame.style.left = `${Math.floor(((screen.clientWidth - (VIEW_W * k) / dpr) / 2) * dpr) / dpr}px`;
        // In portrait (phones), sit near the top like a Game Boy screen, leaving room below for the text box.
        const centred = (screen.clientHeight - (VIEW_H * k) / dpr) / 2;
        const top = screen.clientHeight > screen.clientWidth ? Math.min(centred, 56) : centred;
        frame.style.top = `${Math.floor(top * dpr) / dpr}px`;
      }
    };
    const observer = new ResizeObserver(fit);
    if (screenRef.current) observer.observe(screenRef.current);
    // Closing or navigating away from the tab is a real goodbye, not a dropped connection,
    // so leave properly and friends see you go right away.
    const onPageHide = () => void roomRef.current?.leave(true);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      clearTimeout(start);
      observer.disconnect();
      window.removeEventListener("pagehide", onPageHide);
      game?.destroy(true);
      sceneRef.current = null;
      void roomRef.current?.leave();
      roomRef.current = null;
      setBubbles([]);
      setEmotes([]);
    };
    // connect and notice are fixed for the lifetime of this screen; target changes rejoin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, target]);

  // Keep speech bubbles and emotes pinned above heads as characters and the camera move.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const scene = sceneRef.current;
      overlayRef.current?.querySelectorAll<HTMLElement>("[data-session]").forEach((el) => {
        const p = scene?.screenPoint(el.dataset.session!);
        el.style.visibility = p ? "visible" : "hidden";
        if (p) el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const setPocket = useCallback((on: boolean) => {
    setPocketState(on);
    writePocket(on);
    sceneRef.current?.setPocket(on);
  }, []);

  const toggleRun = useCallback(() => {
    input.runToggle = !input.runToggle;
    setRunning(input.runToggle);
  }, [input]);

  const openSay = useCallback(() => {
    input.releaseAll();
    setEmoteOpen(false);
    setSayOpen(true);
    setTimeout(() => sayRef.current?.focus());
  }, [input]);

  function sendSay(e: FormEvent) {
    e.preventDefault();
    const text = sayText.trim();
    if (text) roomRef.current?.say(text);
    setSayText("");
    setSayOpen(false);
    sayRef.current?.blur();
  }

  function sendEmote(emote: Emote) {
    roomRef.current?.emote(emote);
    setEmoteOpen(false);
  }

  // Keyboard: Esc menu, T to talk, X mirrors run into the UI, 1–8 pick an emote while the picker is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        if (sayOpen) return setSayOpen(false);
        if (emoteOpen) return setEmoteOpen(false);
        if (!socialUi?.panel) setMenuOpen((m) => !m);
        return;
      }
      if (typing) return;
      if ((e.key === "t" || e.key === "T") && !dialogueRef.current) {
        e.preventDefault();
        openSay();
      }
      if (e.key === "x" || e.key === "X") setTimeout(() => setRunning(input.runToggle));
      if (emoteOpen && /^[1-8]$/.test(e.key)) sendEmote(EMOTES[Number(e.key) - 1]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Test and debugging hooks (development builds only).
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_TEST_HOOKS !== "1") return;
    (window as unknown as { __hearth?: unknown }).__hearth = {
      snapshot: () => sceneRef.current?.snapshot(),
      drop: () => roomRef.current?.simulateDrop(),
      setHour: (h?: number) => sceneRef.current?.setHourOverride(h),
      status: () => status,
      roomId: () => roomRef.current?.roomId,
      dialogue: () => (dialogueRef.current ? dialogueRef.current.pages[dialogueRef.current.page] : null),
    };
  }, [status]);

  const page = dialogue ? dialogue.pages[dialogue.page] : undefined;

  return (
    <main className={`world ${touch ? "touch" : ""}`}>
      <div className="world-screen" ref={screenRef}>
        <div className="world-frame" ref={frameRef}>
          <div ref={hostRef} className="world-canvas" />
          <div className="world-overlay" ref={overlayRef} aria-hidden="true">
            {bubbles.map((b) => (
              <div key={b.key} className="speech" data-session={b.sessionId}>
                <span>{b.text}</span>
              </div>
            ))}
            {emotes.map((e) => (
              <div key={e.key} className="float-emote" data-session={e.sessionId}>
                <EmoteIcon emote={e.emote} size={24} />
              </div>
            ))}
          </div>
          {page !== undefined && (
            <DialogueBox
              className="world-dialogue"
              text={page}
              speaker={dialogue?.speaker}
              revealSignal={reveal}
              onTypingChange={(t) => (typingRef.current = t)}
            />
          )}
          {sayOpen && (
            <form className="say-box" onSubmit={sendSay}>
              <label className="visually-hidden" htmlFor="say-input">
                Say something to people nearby
              </label>
              <input
                id="say-input"
                ref={sayRef}
                value={sayText}
                maxLength={SAY_MAX}
                onChange={(e) => setSayText(e.target.value)}
                placeholder="Say something…"
                autoComplete="off"
                onBlur={() => !sayText && setSayOpen(false)}
              />
              <button type="submit" className="chip">
                Say
              </button>
            </form>
          )}
          {emoteOpen && (
            <div className="window emote-picker" role="menu" aria-label="Emotes">
              {EMOTES.map((em, i) => (
                <button
                  key={em}
                  type="button"
                  role="menuitem"
                  className="chip"
                  onClick={() => sendEmote(em)}
                  aria-label={EMOTE_LABELS[em]}
                >
                  <EmoteIcon emote={em} size={20} />
                  {!touch && <span className="hint">{i + 1}</span>}
                </button>
              ))}
            </div>
          )}
          {logOpen && (
            <section className="window chat-log" aria-label="Chat log">
              <ol>
                {!log.length && <li className="hint">Nothing said nearby yet.</li>}
                {log.map((l) => (
                  <li key={l.key}>
                    <strong>{l.name}:</strong> {l.text}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {menuOpen && (
            <nav className="window world-menu" aria-label="Menu">
              <ul className="menu">
                <li>
                  <button className="menu-item" onClick={() => setPocket(!pocket)} autoFocus>
                    Pocket mode: {pocket ? "On" : "Off"}
                  </button>
                </li>
                <li>
                  <button className="menu-item" onClick={toggleRun}>
                    Always run: {running ? "On" : "Off"}
                  </button>
                </li>
                {socialUi && (
                  <li>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setMenuOpen(false);
                        socialUi.openSettings();
                      }}
                    >
                      Settings
                    </button>
                  </li>
                )}
                <li>
                  <button className="menu-item" onClick={onExit}>
                    Leave town
                  </button>
                </li>
                <li>
                  <button className="menu-item" onClick={() => setMenuOpen(false)}>
                    Close
                  </button>
                </li>
              </ul>
            </nav>
          )}
        </div>
        <nav className="world-toolbar" aria-label="World actions">
          <button type="button" className="chip" onClick={openSay}>
            Say
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setEmoteOpen((o) => !o)}
            aria-expanded={emoteOpen}
          >
            Emote
          </button>
          <button type="button" className="chip" onClick={() => setLogOpen((o) => !o)} aria-pressed={logOpen}>
            Log
          </button>
          {socialUi && (
            <>
              <button type="button" className="chip" onClick={() => socialUi.openChat()}>
                Chats{unread > 0 && <span className="unread inline">{unread}</span>}
              </button>
              <button type="button" className="chip" onClick={() => socialUi.openFriends()}>
                Friends
              </button>
            </>
          )}
          <button
            type="button"
            className="chip"
            onClick={() => setMenuOpen((m) => !m)}
            aria-expanded={menuOpen}
          >
            Menu
          </button>
        </nav>
        {status !== "connected" && (
          <div className="world-banner" role="status">
            {status === "joining" && "Walking into town…"}
            {status === "reconnecting" && "Connection lost. Reconnecting…"}
            {status === "replaced" && (
              <>
                You opened Hearth somewhere else.{" "}
                <button className="chip" onClick={onExit}>
                  OK
                </button>
              </>
            )}
            {(status === "left" || status === "error") && (
              <>
                {error || "You were disconnected."}{" "}
                <button className="chip" onClick={onRetry}>
                  Try again
                </button>{" "}
                <button className="chip" onClick={onExit}>
                  Back
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {touch ? (
        <TouchPad input={input} running={running} onToggleRun={toggleRun} />
      ) : (
        <p className="world-help hint">
          Arrows/WASD: walk · Z/Enter: talk · T: say · X: run {running ? "(on)" : "(off)"} · Esc: menu · Click
          someone for their card
        </p>
      )}
    </main>
  );
}
