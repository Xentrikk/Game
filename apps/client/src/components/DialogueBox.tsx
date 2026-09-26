import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "./motion";

const MS_PER_CHAR = 28;

interface Props {
  text: string;
  /** Shown above the text, e.g. an NPC's name. */
  speaker?: string;
  /** Increment to finish the typewriter effect immediately (e.g. when A is pressed). */
  revealSignal?: number;
  /** Called with true while text is still typing, false once it's all shown. */
  onTypingChange?: (typing: boolean) => void;
  className?: string;
}

/** Pokémon/FF-style text box: types out its text, shows ▼ when done. Click to skip. */
export function DialogueBox({ text, speaker, revealSignal = 0, onTypingChange, className }: Props) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? text.length : 0);

  useEffect(() => {
    setShown(reduced ? text.length : 0);
  }, [text, reduced]);

  useEffect(() => {
    if (revealSignal) setShown(text.length);
  }, [revealSignal, text.length]);

  useEffect(() => {
    if (shown >= text.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), MS_PER_CHAR);
    return () => clearTimeout(t);
  }, [shown, text]);

  const done = shown >= text.length;
  useEffect(() => {
    onTypingChange?.(!done);
  }, [done, onTypingChange]);

  return (
    <div
      className={`dialogue ${className ?? ""}`}
      onClick={() => setShown(text.length)}
      role="status"
      aria-live="polite"
    >
      {speaker && <div className="speaker">{speaker}</div>}
      <span aria-hidden="true">{text.slice(0, shown)}</span>
      <span className="visually-hidden">{text}</span>
      {done && (
        <span className="next" aria-hidden="true">
          ▼
        </span>
      )}
    </div>
  );
}
