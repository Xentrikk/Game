import type { Dir } from "@hearth/shared";
import type { PointerEvent } from "react";
import type { InputState } from "./input";

const ARROWS: Record<Dir, string> = { up: "▲", down: "▼", left: "◀", right: "▶" };

/** Game Boy–style on-screen controls: D-pad on the left, A and B on the right. */
export function TouchPad({
  input,
  running,
  onToggleRun,
}: {
  input: InputState;
  running: boolean;
  onToggleRun: () => void;
}) {
  const hold = (dir: Dir) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture isn't available for every pointer; releasing still works via pointerup */
      }
      input.press(dir);
    },
    onPointerUp: () => input.release(dir),
    onPointerCancel: () => input.release(dir),
    onLostPointerCapture: () => input.release(dir),
  });

  return (
    <div className="pad" role="group" aria-label="Game controls">
      <div className="dpad">
        {(["up", "left", "right", "down"] as Dir[]).map((d) => (
          <button key={d} type="button" className={`dpad-${d}`} aria-label={`Move ${d}`} {...hold(d)}>
            {ARROWS[d]}
          </button>
        ))}
      </div>
      <div className="ab">
        <button
          type="button"
          className="round b"
          aria-label={running ? "Run: on" : "Run: off"}
          aria-pressed={running}
          onPointerDown={(e) => {
            e.preventDefault();
            onToggleRun();
          }}
        >
          B
        </button>
        <button
          type="button"
          className="round a"
          aria-label="A: talk or read"
          onPointerDown={(e) => {
            e.preventDefault();
            input.pressA();
          }}
        >
          A
        </button>
      </div>
    </div>
  );
}
