import {
  ACCESSORIES,
  BIO_MAX,
  BODIES,
  BOTTOMS,
  CLOTHING_PALETTE,
  DISPLAY_NAME_MAX,
  EYE_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  PRONOUNS_MAX,
  SHOES,
  SKIN_TONES,
  TOPS,
  changeGarment,
  defaultAppearance,
  profileDetailsSchema,
  randomAppearance,
  type Appearance,
  type CharacterRequest,
  type Garment,
  type GarmentChoice,
  type Option,
} from "@hearth/shared";
import { useState, type FormEvent } from "react";
import { CharacterSprite } from "../components/CharacterSprite";
import { DIRECTIONS, type Direction } from "../sprites/format";
import { describeError } from "../errors";

const TABS = ["Body", "Hair", "Eyes", "Top", "Bottom", "Shoes", "Extra", "About"] as const;
type Tab = (typeof TABS)[number];
const SLOT_NAMES = ["Main color", "Second color", "Third color"];

interface Props {
  handle: string;
  initial?: { appearance: Appearance; displayName: string; pronouns: string; bio: string };
  onDone: () => void;
  onCancel?: () => void;
  /** Saves the character (the real app calls the API; the demo keeps it on the device). */
  onSave: (req: CharacterRequest) => Promise<unknown>;
}

export function Creator({ handle, initial, onDone, onCancel, onSave }: Props) {
  const [appearance, setAppearance] = useState<Appearance>(initial?.appearance ?? defaultAppearance());
  const [history, setHistory] = useState<Appearance[]>([]);
  const [tab, setTab] = useState<Tab>("Body");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? handle);
  const [pronouns, setPronouns] = useState(initial?.pronouns ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [direction, setDirection] = useState<Direction>("down");
  const [rotate, setRotate] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(next: Appearance) {
    setHistory((h) => [...h.slice(-49), appearance]);
    setAppearance(next);
  }
  function undo() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setAppearance(prev);
  }
  function turn(step: number) {
    setRotate(false);
    setDirection((d) => DIRECTIONS[(DIRECTIONS.indexOf(d) + step + DIRECTIONS.length) % DIRECTIONS.length]!);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const details = profileDetailsSchema.safeParse({ displayName, pronouns, bio });
    if (!details.success) {
      setTab("About");
      return setError(details.error.issues[0]?.message ?? "Check your details.");
    }
    setBusy(true);
    try {
      await onSave({ ...details.data, appearance });
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const garmentPanel = (key: "top" | "bottom" | "shoes", list: Garment[]) => (
    <GarmentPicker
      list={list}
      value={appearance[key]}
      onChange={(g) => g && update({ ...appearance, [key]: g })}
      label={key}
    />
  );

  return (
    <main className="screen">
      <form className="window wide" onSubmit={save} aria-labelledby="creator-title">
        <h2 id="creator-title">{initial ? "Wardrobe" : "Make your character"}</h2>
        <div className="creator">
          <div className="preview">
            <div className="stage">
              <CharacterSprite appearance={appearance} scale={8} direction={direction} rotate={rotate} />
            </div>
            <div className="row" style={{ justifyContent: "center" }}>
              <button type="button" className="chip" onClick={() => turn(-1)} aria-label="Turn left">
                ◀
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setRotate((r) => !r)}
                aria-pressed={rotate}
              >
                Spin
              </button>
              <button type="button" className="chip" onClick={() => turn(1)} aria-label="Turn right">
                ▶
              </button>
            </div>
            <div className="row" style={{ justifyContent: "center" }}>
              <button type="button" className="chip" onClick={() => update(randomAppearance())}>
                Randomize
              </button>
              <button type="button" className="chip" onClick={undo} disabled={!history.length}>
                Undo
              </button>
            </div>
            <p className="hint" style={{ textAlign: "center" }}>
              {displayName || handle} <br />@{handle}
            </p>
          </div>

          <div>
            <div className="tabs" role="tablist" aria-label="Character options">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === t}
                  aria-controls="creator-panel"
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div id="creator-panel" role="tabpanel" aria-label={tab}>
              {tab === "Body" && (
                <>
                  <p className="section-label">Body</p>
                  <Chips
                    options={BODIES}
                    value={appearance.body}
                    onChange={(body) => update({ ...appearance, body })}
                  />
                  <p className="section-label">Skin tone</p>
                  <Swatches
                    colors={SKIN_TONES.map((p) => p[0])}
                    value={appearance.skin}
                    onChange={(skin) => update({ ...appearance, skin })}
                    name="Skin tone"
                  />
                </>
              )}
              {tab === "Hair" && (
                <>
                  <p className="section-label">Style</p>
                  <Chips
                    options={HAIR_STYLES}
                    value={appearance.hair.style}
                    onChange={(style) => update({ ...appearance, hair: { ...appearance.hair, style } })}
                  />
                  <p className="section-label">Color</p>
                  <Swatches
                    colors={HAIR_COLORS.map((p) => p[0])}
                    value={appearance.hair.color}
                    onChange={(color) => update({ ...appearance, hair: { ...appearance.hair, color } })}
                    name="Hair color"
                  />
                </>
              )}
              {tab === "Eyes" && (
                <>
                  <p className="section-label">Style</p>
                  <Chips
                    options={EYE_STYLES}
                    value={appearance.eyes.style}
                    onChange={(style) => update({ ...appearance, eyes: { ...appearance.eyes, style } })}
                  />
                  <p className="section-label">Color</p>
                  <Swatches
                    colors={EYE_COLORS}
                    value={appearance.eyes.color}
                    onChange={(color) => update({ ...appearance, eyes: { ...appearance.eyes, color } })}
                    name="Eye color"
                  />
                </>
              )}
              {tab === "Top" && garmentPanel("top", TOPS)}
              {tab === "Bottom" && garmentPanel("bottom", BOTTOMS)}
              {tab === "Shoes" && garmentPanel("shoes", SHOES)}
              {tab === "Extra" && (
                <GarmentPicker
                  list={ACCESSORIES}
                  value={appearance.accessory}
                  onChange={(accessory) => update({ ...appearance, accessory })}
                  label="accessory"
                  allowNone
                />
              )}
              {tab === "About" && (
                <>
                  <label className="field">
                    <span>Display name</span>
                    <input
                      value={displayName}
                      maxLength={DISPLAY_NAME_MAX}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Pronouns (optional)</span>
                    <input
                      value={pronouns}
                      maxLength={PRONOUNS_MAX}
                      onChange={(e) => setPronouns(e.target.value)}
                      placeholder="e.g. she/her, they/them"
                    />
                  </label>
                  <label className="field">
                    <span>
                      Bio ({bio.length}/{BIO_MAX})
                    </span>
                    <textarea
                      value={bio}
                      maxLength={BIO_MAX}
                      rows={3}
                      onChange={(e) => setBio(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <p className="error" role="alert">
              {error}
            </p>
            <div className="actions">
              {onCancel && (
                <button type="button" className="btn" onClick={onCancel}>
                  Cancel
                </button>
              )}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? "Saving…" : initial ? "Save" : "Done!"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </main>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="chip"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}

function Swatches({
  colors,
  value,
  onChange,
  name,
}: {
  colors: string[];
  value: number;
  onChange: (i: number) => void;
  name: string;
}) {
  return (
    <div className="swatches" role="group" aria-label={name}>
      {colors.map((c, i) => (
        <button
          key={i}
          type="button"
          className="swatch"
          style={{ background: c }}
          aria-pressed={value === i}
          aria-label={`${name} ${i + 1}`}
          onClick={() => onChange(i)}
        />
      ))}
    </div>
  );
}

function GarmentPicker({
  list,
  value,
  onChange,
  label,
  allowNone,
}: {
  list: Garment[];
  value: GarmentChoice | null;
  onChange: (g: GarmentChoice | null) => void;
  label: string;
  allowNone?: boolean;
}) {
  const def = value ? list.find((g) => g.id === value.id) : undefined;
  return (
    <>
      <p className="section-label">Style</p>
      <div className="chips">
        {allowNone && (
          <button type="button" className="chip" aria-pressed={!value} onClick={() => onChange(null)}>
            None
          </button>
        )}
        {list.map((g) => (
          <button
            key={g.id}
            type="button"
            className="chip"
            aria-pressed={value?.id === g.id}
            onClick={() => onChange(changeGarment(list, value, g.id))}
          >
            {g.name}
          </button>
        ))}
      </div>
      {value &&
        def &&
        value.colors.map((ci, slot) => (
          <div key={slot}>
            <p className="section-label">{SLOT_NAMES[slot]}</p>
            <Swatches
              colors={CLOTHING_PALETTE}
              value={ci}
              name={`${label} ${SLOT_NAMES[slot]!.toLowerCase()}`}
              onChange={(c) =>
                onChange({ ...value, colors: value.colors.map((old, i) => (i === slot ? c : old)) })
              }
            />
          </div>
        ))}
    </>
  );
}
