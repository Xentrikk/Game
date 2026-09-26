import type { ReportReason } from "@hearth/shared";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatPanel } from "./ChatPanel";
import { SocialUiContext, type PanelState, type SocialUi } from "./contexts";
import { FriendsPanel } from "./FriendsPanel";
import { ProfileCard } from "./ProfileCard";
import { SettingsPanel } from "./SettingsPanel";

export { useSocialUi } from "./contexts";

/**
 * Owns the social overlays (friends, chats, settings, profile cards) so any screen can open them.
 * The world screen registers a "Go to friend" handler (setGoTo) while it's open.
 */
export function SocialUiProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelState>(null);
  const [goTo, setGoToState] = useState<((roomId: string) => void) | null>(null);
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const [profile, setProfile] = useState<{
    handle: string;
    reportSay?: (r: ReportReason, n: string) => Promise<unknown>;
  } | null>(null);

  const openChat = useCallback((conversationId: string | null = null) => {
    setProfile(null);
    setPanel({ kind: "chat", conversationId });
  }, []);

  const ui = useMemo<SocialUi>(
    () => ({
      panel,
      openFriends: (tab) => setPanel({ kind: "friends", tab }),
      openChat,
      openSettings: () => setPanel({ kind: "settings" }),
      openProfile: (handle, reportSay) => setProfile({ handle, reportSay }),
      close: () => setPanel(null),
      setGoTo: (handler) => setGoToState(() => handler),
    }),
    [panel, openChat],
  );

  const close = () => setPanel(null);
  return (
    <SocialUiContext.Provider value={ui}>
      {children}
      {panel?.kind === "friends" && (
        <FriendsPanel
          onClose={close}
          initialTab={panel.tab}
          onOpenProfile={(h) => setProfile({ handle: h })}
          onOpenChat={openChat}
          onGoTo={
            goTo
              ? (roomId) => {
                  close();
                  goToRef.current?.(roomId);
                }
              : undefined
          }
        />
      )}
      {panel?.kind === "chat" && (
        <ChatPanel
          onClose={close}
          initialConversation={panel.conversationId}
          onOpenProfile={(h) => setProfile({ handle: h })}
        />
      )}
      {panel?.kind === "settings" && <SettingsPanel onClose={close} />}
      {profile && (
        <ProfileCard
          handle={profile.handle}
          reportSay={profile.reportSay}
          onClose={() => setProfile(null)}
          onOpenChat={openChat}
        />
      )}
    </SocialUiContext.Provider>
  );
}
