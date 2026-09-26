import type { Me } from "@hearth/shared";
import { useSocial } from "../social/context";
import { useSocialUi } from "../social/contexts";
import { CharacterSprite } from "../components/CharacterSprite";
import { DialogueBox } from "../components/DialogueBox";

export function Home({
  me,
  onTown,
  onWardrobe,
  onAccount,
}: {
  me: Me;
  onTown: () => void;
  onWardrobe: () => void;
  onAccount: () => void;
}) {
  const profile = me.profile!;
  const ui = useSocialUi();
  const conversations = useSocial((s) => s.conversations);
  const friends = useSocial((s) => s.friends);
  const unread = conversations.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
  const requests = friends?.incoming.length ?? 0;
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
        <DialogueBox text="You're all set! Add your friends, then meet them in the Town Square." />
        <ul className="menu">
          <li>
            <button className="menu-item btn-primary" onClick={onTown} autoFocus>
              Enter the Town Square
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={() => ui.openChat()}>
              Chats{unread > 0 && <span className="unread inline">{unread}</span>}
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={() => ui.openFriends(requests ? "requests" : "friends")}>
              Friends{requests > 0 && <span className="unread inline">{requests}</span>}
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={onWardrobe}>
              Wardrobe
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={() => ui.openSettings()}>
              Settings
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
