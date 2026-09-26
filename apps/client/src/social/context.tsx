import { useEffect, useState, type ReactNode } from "react";
import { StoreContext } from "./contexts";
import { SocialStore } from "./store";

export { useSocial, useSocialOptional, useSocialStore } from "./contexts";

/** Starts the live connection for a signed-in user and shares the social store with the app. */
export function SocialProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [store] = useState(() => new SocialStore(userId));
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
