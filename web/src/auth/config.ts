/**
 * Which Cognito app client this browser tab signs in through.
 *
 * Patients and staff sign in through different app clients (FR-ACC-03): only
 * the patient client offers Google, and the staff client keeps its session
 * for a working day rather than a month. Amplify holds one configuration at a
 * time, so the tab is configured for one audience and reconfigured when a
 * sign-in screen for the other is opened.
 *
 * A staff session lives in sessionStorage, because a front desk computer is
 * shared: closing the tab ends it, unless the person trusts the workstation
 * for 12 hours (FR-ACC-10), which an administrator never can. The staff
 * client's refresh token lives 12 hours, so the server holds the same line.
 * A patient chooses on the sign-in screen.
 */

import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { defaultStorage, sessionStorage } from "aws-amplify/utils";

export type Audience = "patient" | "staff";

const AUDIENCE_KEY = "atria.audience";
const PERSIST_KEY = "atria.persist";
const TRUST_KEY = "atria.staff-trust-until";
export const TRUST_HOURS = 12;

function required(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
    throw new Error(`${name} is not set. Run python tools/web_env.py to write web/.env.local.`);
  }
  return value;
}

export const settings = {
  region: required("VITE_REGION"),
  userPoolId: required("VITE_USER_POOL_ID"),
  clients: {
    patient: required("VITE_PATIENT_CLIENT_ID"),
    staff: required("VITE_STAFF_CLIENT_ID"),
  },
  authDomain: required("VITE_AUTH_DOMAIN"),
};

let current: Audience | null = null;

function remembered<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the tab still works, it just forgets.
  }
}

/** Configure Amplify for one audience. Cheap to call again with the same one. */
export function configureFor(audience: Audience): void {
  if (current === audience) return;
  const origin = window.location.origin;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: settings.userPoolId,
        userPoolClientId: settings.clients[audience],
        loginWith:
          audience === "patient"
            ? {
                email: true,
                oauth: {
                  domain: settings.authDomain,
                  scopes: ["openid", "email", "profile"],
                  redirectSignIn: [`${origin}/auth/callback`],
                  redirectSignOut: [`${origin}/`],
                  responseType: "code",
                },
              }
            : { email: true },
      },
    },
  });
  const persist = audience === "patient" ? remembered(PERSIST_KEY, "yes", ["yes", "no"]) === "yes" : trusted();
  cognitoUserPoolsTokenProvider.setKeyValueStorage(persist ? defaultStorage : sessionStorage);
  current = audience;
  remember(AUDIENCE_KEY, audience);
}

/** The audience this tab last signed in as, so a reload finds its session. */
export function lastAudience(): Audience {
  return remembered<Audience>(AUDIENCE_KEY, "patient", ["patient", "staff"]);
}

/** "Keep me signed in": a patient's session outlives the tab only if they ask. */
export function setPatientPersistence(keep: boolean): void {
  remember(PERSIST_KEY, keep ? "yes" : "no");
  if (current === "patient") {
    cognitoUserPoolsTokenProvider.setKeyValueStorage(keep ? defaultStorage : sessionStorage);
  }
}

/** Whether this workstation is trusted for a staff session right now. */
export function trusted(): boolean {
  try {
    const until = Number(window.localStorage.getItem(TRUST_KEY) ?? 0);
    if (until > Date.now()) return true;
    window.localStorage.removeItem(TRUST_KEY);
  } catch {
    // Storage refused: nothing is trusted.
  }
  return false;
}

/** Trust this workstation for 12 hours, or stop trusting it, before a staff sign-in. */
export function setStaffTrust(trust: boolean): void {
  try {
    if (trust) window.localStorage.setItem(TRUST_KEY, String(Date.now() + TRUST_HOURS * 3600000));
    else window.localStorage.removeItem(TRUST_KEY);
  } catch {
    // A private window may refuse; the session then ends with the tab.
  }
  if (current === "staff") cognitoUserPoolsTokenProvider.setKeyValueStorage(trust ? defaultStorage : sessionStorage);
}

/**
 * Take back a trusted staff session: its tokens move from the browser's
 * lasting storage to the tab's, so it ends with the tab. For an
 * administrator, who never keeps a session (FR-ACC-10), and at sign-out.
 */
export function untrust(): void {
  const prefix = `CognitoIdentityServiceProvider.${settings.clients.staff}.`;
  try {
    window.localStorage.removeItem(TRUST_KEY);
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith(prefix)) continue;
      window.sessionStorage.setItem(key, window.localStorage.getItem(key) ?? "");
      window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing kept, nothing to move.
  }
  if (current === "staff") cognitoUserPoolsTokenProvider.setKeyValueStorage(sessionStorage);
}
