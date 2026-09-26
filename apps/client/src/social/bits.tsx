import {
  GROUP_ICONS,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type GroupIcon as GroupIconId,
  type Presence,
  type PublicProfile,
  type ReportReason,
} from "@hearth/shared";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CharacterSprite } from "../components/CharacterSprite";
import { describeError } from "../errors";

/** A small, still portrait of someone's character. */
export function Avatar({ profile, scale = 2 }: { profile: PublicProfile; scale?: number }) {
  return (
    <span className="avatar" aria-hidden="true">
      {profile.appearance && (
        <CharacterSprite appearance={profile.appearance} scale={scale} walking={false} />
      )}
    </span>
  );
}

export function presenceLabel(p: Presence | undefined): string {
  if (!p || p.status === "offline") return "Offline";
  const where = p.location ? " · Town Square" : "";
  if (p.status === "dnd") return `Do not disturb${where}`;
  if (p.status === "away") return `Away${where}`;
  return `Online${where}`;
}

export function PresenceDot({ presence }: { presence: Presence | undefined }) {
  return <span className={`dot dot-${presence?.status ?? "offline"}`} aria-hidden="true" />;
}

/** 8×8 pixel icons for group chats, drawn as crisp SVG. */
const ICON_ART: Record<GroupIconId, [string, string[]]> = {
  star: [
    "#f4d04a",
    ["...#....", "...#....", "#######.", ".#####..", "..###...", ".##.##..", "##...##.", "........"],
  ],
  heart: [
    "#f08ac0",
    [".##.##..", "#######.", "#######.", ".#####..", "..###...", "...#....", "........", "........"],
  ],
  leaf: [
    "#6ac84a",
    ["....###.", "..#####.", ".######.", ".#####..", ".####...", "#.##....", "#.......", "........"],
  ],
  moon: [
    "#c8b8f0",
    ["..###...", ".##.....", "##......", "##......", "##......", ".##.....", "..###...", "........"],
  ],
  sun: [
    "#f08a3a",
    ["#..#..#.", ".#.#.#..", "..###...", "#######.", "..###...", ".#.#.#..", "#..#..#.", "........"],
  ],
  music: [
    "#4ac8b8",
    ["..####..", "..#..#..", "..#..#..", "..#..#..", "###.###.", "###.###.", "........", "........"],
  ],
  fish: [
    "#4a9ae8",
    ["........", "..###..#", ".#####.#", "#.######", ".#####.#", "..###..#", "........", "........"],
  ],
  cat: [
    "#c68a3e",
    ["#.....#.", "##...##.", "#######.", "#.#.#.#.", "#######.", ".#####..", "........", "........"],
  ],
};

export function GroupIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  const [color, rows] =
    ICON_ART[(GROUP_ICONS as readonly string[]).includes(icon) ? (icon as GroupIconId) : "star"];
  return (
    <svg
      className="group-icon"
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} /> : null,
        ),
      )}
    </svg>
  );
}

/** A dialog window over the page. Escape or the backdrop closes it. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Capture phase, and stop there: Escape closes only this dialog, not the panel or menu under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    ref.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="window modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** A side panel on wide screens, a bottom sheet on phones. The world keeps running behind it. */
export function Panel({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="window panel" aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
        <div className="row">
          {actions}
          <button type="button" className="chip" onClick={onClose} aria-label={`Close ${title}`}>
            ✕
          </button>
        </div>
      </header>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

/** Pick a reason and send a report. `onSubmit` does the actual reporting (API or world room). */
export function ReportDialog({
  name,
  onSubmit,
  onClose,
}: {
  name: string;
  onSubmit: (reason: ReportReason, note: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) return setError("Pick what's wrong.");
    try {
      await onSubmit(reason, note);
      setDone(true);
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Modal title={`Report ${name}`} onClose={onClose}>
      {done ? (
        <>
          <p>Thanks. Our team will look at this. You can also block {name} so they can't reach you.</p>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <fieldset className="reasons">
            <legend className="section-label">What's wrong?</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r} className="check">
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                <span>{REPORT_REASON_LABELS[r]}</span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Anything else? (optional)</span>
            <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {reason === "self_harm" && (
            <p className="hint">
              If someone is in danger right now, contact local emergency services. In the US you can call or
              text 988.
            </p>
          )}
          <p className="error" role="alert">
            {error}
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Send report
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
