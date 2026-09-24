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
 * shared: closing the tab ends it. A patient chooses on the sign-in screen.
 */

import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { defaultStorage, sessionStorage } from "aws-amplify/utils";

export type Audience = "patient" | "staff";

const AUDIENCE_KEY = "atria.audience";
const PERSIST_KEY = "atria.persist";

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
  const persist = audience === "patient" && remembered(PERSIST_KEY, "yes", ["yes", "no"]) === "yes";
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
