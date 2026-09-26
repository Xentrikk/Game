import { type Appearance, type CharacterRequest } from "@hearth/shared";
import { useState } from "react";
import { CharacterSprite } from "../components/CharacterSprite";
import { DialogueBox } from "../components/DialogueBox";
import { demoConnection } from "../game/demoConnection";
import { Creator } from "../screens/Creator";
import World from "../screens/World";

const STORAGE_KEY = "hearth.demo.character";
type Saved = { appearance: Appearance; displayName: string; pronouns: string; bio: string };

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(c: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable: the character lasts for this visit only */
  }
}

const TOWN_NOTICE = {
  speaker: "Hearth preview",
  pages: [
    "Welcome to the Town Square! This preview runs on your device only.",
    "The villagers walking around are bots standing in for your friends. In the real game, the people here are your friends, live.",
    "Walk with the arrow keys or D-pad. Hold Shift or tap B to run. Press Z, Enter or A to read signs and talk to Mayor Pip, Fern and Robin.",
    "Try the Menu for Pocket mode.",
  ],
};

type Stage = "welcome" | "create" | "town";

export function DemoApp() {
  const [character, setCharacter] = useState<Saved | null>(load);
  const [stage, setStage] = useState<Stage>("welcome");

  if (stage === "create") {
    return (
      <Creator
        handle="you"
        initial={character ?? undefined}
        onSave={async (req: CharacterRequest) => {
          const next = {
            appearance: req.appearance,
            displayName: req.displayName,
            pronouns: req.pronouns,
            bio: req.bio,
          };
          save(next);
          setCharacter(next);
        }}
        onDone={() => setStage("town")}
        onCancel={character ? () => setStage("welcome") : undefined}
      />
    );
  }

  if (stage === "town" && character) {
    return (
      <World
        onExit={() => setStage("welcome")}
        connect={async () =>
          demoConnection({ handle: "you", name: character.displayName, appearance: character.appearance })
        }
        notice={TOWN_NOTICE}
      />
    );
  }

  return (
    <main className="screen">
      <section className="window" aria-labelledby="demo-title">
        <h1 id="demo-title">Hearth</h1>
        {character && (
          <div className="stage" style={{ marginBottom: 16 }}>
            <CharacterSprite
              appearance={character.appearance}
              scale={6}
              label={`${character.displayName}'s character`}
            />
          </div>
        )}
        <DialogueBox
          text={
            character
              ? `Welcome back, ${character.displayName}! The Town Square is waiting.`
              : "Welcome! Hearth is a little world where your friends live. Make a character, then take a walk around town."
          }
        />
        <ul className="menu">
          {character && (
            <li>
              <button className="menu-item btn-primary" onClick={() => setStage("town")} autoFocus>
                Enter the Town Square
              </button>
            </li>
          )}
          <li>
            <button className="menu-item" onClick={() => setStage("create")} autoFocus={!character}>
              {character ? "Wardrobe" : "Make your character"}
            </button>
          </li>
        </ul>
        <p className="demo-note">
          Preview build. Sign-up, friends and chat need the full game server, so this preview skips them. Your
          character is saved on this device only.
        </p>
      </section>
    </main>
  );
}
