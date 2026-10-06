/**
 * Who is signed in, as the API sees them.
 *
 * A Cognito session alone is not enough: an account the API cannot resolve,
 * such as a confirmed patient whose records the trigger has not written, has
 * valid tokens and no access. So the session is "signed in" only once GET /me
 * answers, and the roles it returns decide where the person lands.
 */

import { fetchAuthSession, signOut as amplifySignOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, type Me } from "../api/client";
import { type Audience, configureFor, lastAudience, trusted, untrust } from "./config";

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: Me; audience: Audience }
  | { status: "unresolved"; message: string };

interface Session {
  state: State;
  /** Ask the API again, after a sign-in completes. */
  refresh: (audience: Audience) => Promise<State>;
  /** This device, or every device the account is signed in on (FR-ACC-12). */
  signOut: (options?: { everywhere?: boolean }) => Promise<void>;
}

/** Exported for the development preview (src/dev), which supplies a fixed session. */
export const SessionContext = createContext<Session | null>(null);

async function resolve(audience: Audience): Promise<State> {
  configureFor(audience);
  const session = await fetchAuthSession().catch(() => null);
  if (!session?.tokens?.accessToken) return { status: "signed-out" };
  try {
    const me = await api<Me>("/me");
    // An administrator never keeps a session past the tab (FR-ACC-10).
    if (audience === "staff" && me.roles.includes("TENANT_ADMIN") && trusted()) untrust();
    return { status: "signed-in", me, audience };
  } catch (error) {
    return {
      status: "unresolved",
      message: error instanceof Error ? error.message : "Your account could not be loaded.",
    };
  }
}

/**
 * The landing screens a sign-in opens on once (the administrator's Overview,
 * a general practitioner's Queue) remember being seen for the tab. A new
 * sign-in starts afresh, or the next account in the same tab opened on the
 * schedule instead (audit 2026-10-06).
 */
export function forgetLandings(): void {
  try {
    sessionStorage.removeItem("atria.overview");
    sessionStorage.removeItem("atria.queue");
  } catch {
    // Without storage there is nothing to forget.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async (audience: Audience) => {
    const next = await resolve(audience);
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    // Google only ever returns a patient, whatever this tab signed in as last.
    const returning = window.location.pathname.startsWith("/auth/callback");
    void refresh(returning ? "patient" : lastAudience());
    // Google returns to /auth/callback and Amplify finishes the exchange in
    // the background; this is the moment the patient is actually signed in.
    return Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signInWithRedirect") void refresh("patient");
    });
  }, [refresh]);

  const signOut = useCallback(async (options?: { everywhere?: boolean }) => {
    try {
      await amplifySignOut({ global: Boolean(options?.everywhere) });
    } catch {
      // Revoking everywhere needs the network. This device signs out anyway.
      await amplifySignOut();
    }
    untrust();
    forgetLandings();
    setState({ status: "signed-out" });
  }, []);

  const value = useMemo(() => ({ state, refresh, signOut }), [state, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

/**
 * The temporary password, held in memory between the staff sign-in screen and
 * the first sign-in screen so the second can refuse it as the new one
 * (ADR 0018). Never written to storage or to history state: a reload drops it
 * and sends the person back to sign in again, which is the safe outcome.
 */
let pendingTemporary: { email: string; password: string } | null = null;

export const firstSignIn = {
  hold(email: string, password: string) {
    pendingTemporary = { email, password };
  },
  peek() {
    return pendingTemporary;
  },
  clear() {
    pendingTemporary = null;
  },
};
