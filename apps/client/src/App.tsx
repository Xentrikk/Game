import type { Me } from "@hearth/shared";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, api } from "./api";
import { joinTown } from "./game/net";
import { supabase } from "./supabase";
import { Account } from "./screens/Account";
import { Creator } from "./screens/Creator";
import { Home } from "./screens/Home";
import { AgeGate, Blocked, PickHandle, Terms } from "./screens/Onboarding";
import { SignIn } from "./screens/SignIn";

// The world pulls in Phaser, so it loads only when someone enters it.
const World = lazy(() => import("./screens/World"));

type State =
  | { name: "loading" }
  | { name: "signedOut" }
  | { name: "blocked" }
  | { name: "error"; message: string }
  | { name: "ready"; me: Me };

export function App() {
  const [state, setState] = useState<State>({ name: "loading" });
  const [overlay, setOverlay] = useState<"none" | "town" | "wardrobe" | "account">("none");
  // Once blocked, stay on the blocked screen until the page is reloaded, even after signing out.
  const blocked = useRef(false);

  const block = useCallback(async () => {
    blocked.current = true;
    setState({ name: "blocked" });
    await supabase.auth.signOut({ scope: "local" });
  }, []);

  const refresh = useCallback(async () => {
    if (blocked.current) return setState({ name: "blocked" });
    const { data } = await supabase.auth.getSession();
    if (!data.session) return setState({ name: "signedOut" });
    try {
      setState({ name: "ready", me: await api.me() });
    } catch (e) {
      if (e instanceof ApiFailure && e.body.error === "not_eligible") return void block();
      if (e instanceof ApiFailure && e.status === 401) {
        await supabase.auth.signOut({ scope: "local" });
        return setState({ name: "signedOut" });
      }
      setState({ name: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }, [block]);

  useEffect(() => {
    // Magic links land on /auth/callback; supabase-js reads the tokens, then we tidy the URL.
    if (location.pathname === "/auth/callback") history.replaceState(null, "", "/");
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setOverlay("none");
        void refresh();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  switch (state.name) {
    case "loading":
      return (
        <main className="screen">
          <p aria-live="polite">Loading…</p>
        </main>
      );
    case "signedOut":
      return <SignIn />;
    case "blocked":
      return <Blocked />;
    case "error":
      return (
        <main className="screen">
          <section className="window">
            <h2>Hmm.</h2>
            <p>{state.message}</p>
            <button className="btn primary" onClick={() => void refresh()}>
              Try again
            </button>
          </section>
        </main>
      );
  }

  const { me } = state;
  const next = () => void refresh();
  const { onboarding } = me;
  if (!onboarding.ageVerified) return <AgeGate onDone={next} onBlocked={() => void block()} />;
  if (!onboarding.termsAccepted) return <Terms onDone={next} />;
  if (!onboarding.handle) return <PickHandle onDone={next} />;
  if (!onboarding.hasCharacter)
    return <Creator handle={onboarding.handle} onDone={next} onSave={api.saveCharacter} />;

  if (overlay === "wardrobe") {
    return (
      <Creator
        handle={onboarding.handle}
        initial={{ appearance: me.appearance!, ...me.profile! }}
        onSave={api.saveCharacter}
        onDone={() => {
          setOverlay("none");
          next();
        }}
        onCancel={() => setOverlay("none")}
      />
    );
  }
  if (overlay === "account") return <Account me={me} onBack={() => setOverlay("none")} onChanged={next} />;
  if (overlay === "town") {
    return (
      <Suspense
        fallback={
          <main className="screen">
            <p aria-live="polite">Loading the Town Square…</p>
          </main>
        }
      >
        <World onExit={() => setOverlay("none")} connect={joinTown} />
      </Suspense>
    );
  }
  return (
    <Home
      me={me}
      onTown={() => setOverlay("town")}
      onWardrobe={() => setOverlay("wardrobe")}
      onAccount={() => setOverlay("account")}
    />
  );
}
