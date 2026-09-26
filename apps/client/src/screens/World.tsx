import { CLOSE_REPLACED, VIEW_H, VIEW_W } from "@hearth/shared";
import Phaser from "phaser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogueBox } from "../components/DialogueBox";
import { InputState } from "../game/input";
import { joinTown, type TownRoom } from "../game/net";
import { ScreenPipeline } from "../game/pocket";
import { TouchPad } from "../game/TouchPad";
import { WorldScene, type WorldUi } from "../game/WorldScene";

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

function useCoarsePointer(): boolean {
  const [coarse] = useState(
    () => forceTouch || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches),
  );
  return coarse;
}

export default function World({ onExit }: { onExit: () => void }) {
  const [status, setStatus] = useState<Status>("joining");
  const [error, setError] = useState("");
  const [dialogue, setDialogue] = useState<{ pages: string[]; page: number; speaker?: string } | null>(null);
  const [reveal, setReveal] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pocket, setPocketState] = useState(readPocket);
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const touch = useCoarsePointer();

  const input = useMemo(() => new InputState(), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const roomRef = useRef<TownRoom | null>(null);
  const dialogueRef = useRef(dialogue);
  const typingRef = useRef(false);
  const menuRef = useRef(menuOpen);
  dialogueRef.current = dialogue;
  menuRef.current = menuOpen;

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
    }),
    [input],
  );

  // Join the Town Square and start Phaser.
  useEffect(() => {
    let cancelled = false;
    let game: Phaser.Game | undefined;
    setStatus("joining");
    // Join on the next tick: React's StrictMode mounts effects twice in development, and two
    // overlapping joins would make the second one "replace" the first.
    const start = setTimeout(() =>
      joinTown()
        .then((room) => {
          if (cancelled) return void room.leave();
          roomRef.current = room;
          room.onDrop(() => setStatus("reconnecting"));
          room.onReconnect(() => setStatus("connected"));
          room.onLeave((code) => setStatus(code === CLOSE_REPLACED ? "replaced" : "left"));
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
          game.scene.add("world", WorldScene, true, { room, ui, pocket: readPocket(), hourOverride });
          game.events.once(Phaser.Core.Events.READY, () => {
            // Scenes only exist once Phaser has booted.
            sceneRef.current = game?.scene.getScene("world") as WorldScene;
            fit();
          });
          setStatus("connected");
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
    };
  }, [ui, attempt]);

  const setPocket = useCallback((on: boolean) => {
    setPocketState(on);
    writePocket(on);
    sceneRef.current?.setPocket(on);
  }, []);

  const toggleRun = useCallback(() => {
    input.runToggle = !input.runToggle;
    setRunning(input.runToggle);
  }, [input]);

  // Escape opens the menu; the keyboard run toggle (X) is mirrored into the UI.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen((m) => !m);
      if (e.key === "x" || e.key === "X") setTimeout(() => setRunning(input.runToggle));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input]);

  // Test and debugging hooks (development builds only).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __hearth?: unknown }).__hearth = {
      snapshot: () => sceneRef.current?.snapshot(),
      drop: () =>
        (
          roomRef.current?.connection as unknown as { transport: { ws: WebSocket } } | undefined
        )?.transport.ws.close(),
      setHour: (h?: number) => sceneRef.current?.setHourOverride(h),
      status: () => status,
      dialogue: () => (dialogueRef.current ? dialogueRef.current.pages[dialogueRef.current.page] : null),
    };
  }, [status]);

  const page = dialogue ? dialogue.pages[dialogue.page] : undefined;

  return (
    <main className={`world ${touch ? "touch" : ""}`}>
      <div className="world-screen" ref={screenRef}>
        <div className="world-frame" ref={frameRef}>
          <div ref={hostRef} className="world-canvas" />
          {page !== undefined && (
            <DialogueBox
              className="world-dialogue"
              text={page}
              speaker={dialogue?.speaker}
              revealSignal={reveal}
              onTypingChange={(t) => (typingRef.current = t)}
            />
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
        <button
          type="button"
          className="chip world-menu-button"
          onClick={() => setMenuOpen((m) => !m)}
          aria-expanded={menuOpen}
        >
          Menu
        </button>
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
                <button className="chip" onClick={() => setAttempt((n) => n + 1)}>
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
          Arrows/WASD: walk · Z/Enter: talk · X: run {running ? "(on)" : "(off)"} · Shift: hold to run · Esc:
          menu
        </p>
      )}
    </main>
  );
}
