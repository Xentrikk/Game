import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "./motion";

const MS_PER_CHAR = 28;

/** Pokémon/FF-style text box: types out its text, shows ▼ when done. Click or press a key to skip. */
export function DialogueBox({ text }: { text: string }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? text.length : 0);

  useEffect(() => {
    setShown(reduced ? text.length : 0);
  }, [text, reduced]);

  useEffect(() => {
    if (shown >= text.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), MS_PER_CHAR);
    return () => clearTimeout(t);
  }, [shown, text]);

  const done = shown >= text.length;
  return (
    <div className="dialogue" onClick={() => setShown(text.length)} role="status" aria-live="polite">
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
