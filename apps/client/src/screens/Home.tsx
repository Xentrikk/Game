import type { Me } from "@hearth/shared";
import { CharacterSprite } from "../components/CharacterSprite";
import { DialogueBox } from "../components/DialogueBox";

export function Home({
  me,
  onWardrobe,
  onAccount,
}: {
  me: Me;
  onWardrobe: () => void;
  onAccount: () => void;
}) {
  const profile = me.profile!;
  return (
    <main className="screen">
      <section className="window" aria-labelledby="home-title">
        <h1 id="home-title">Hearth</h1>
        <div className="stage" style={{ marginBottom: 16 }}>
          <CharacterSprite
            appearance={me.appearance!}
            scale={6}
            walking={false}
            label={`${profile.displayName}'s character`}
          />
        </div>
        <p>
          {profile.displayName} <span className="badge">@{profile.handle}</span>
        </p>
        {profile.pronouns && <p className="hint">{profile.pronouns}</p>}
        {profile.bio && <p className="hint">{profile.bio}</p>}
        <DialogueBox text="You're all set! The Town Square is still being built. Check back soon to meet your friends there." />
        <ul className="menu">
          <li>
            <button className="menu-item" onClick={onWardrobe} autoFocus>
              Wardrobe
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={onAccount}>
              Account
            </button>
          </li>
        </ul>
      </section>
    </main>
  );
}
