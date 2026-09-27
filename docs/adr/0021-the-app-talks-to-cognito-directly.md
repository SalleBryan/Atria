# 0021. The app talks to Cognito directly

Status: accepted
Source: project, starting the Flutter app (patient and staff) at the end of Phase 2

## Context

Patients and staff sign in through different Cognito app clients (FR-ACC-03). Only the patient
client offers Google; the staff client's refresh token lasts a working day, 12 hours, which is
what "trust this workstation" relies on (FR-ACC-10). The web client reconfigures Amplify when a
sign-in screen for the other audience opens.

Amplify for Flutter is configured once per app, with one app client. Signing staff in through
the patient client would give them a patient's 30 day session, and the reverse would cost
patients Google.

Administration is the web console's alone: it is laid out for a desk, and an administrator
signs in with an authenticator (FR-ACC-11). The app is for patients and for staff at work.

## Decision

1. **The app uses `amazon_cognito_identity_dart_2`**, which holds one `CognitoUserPool` per
   audience against the same pool: SRP sign-in, the challenges Cognito can answer with, token
   refresh and global sign-out. `app/lib/auth/auth.dart`.
2. **Tokens live in the platform's secure store** (Keychain, EncryptedSharedPreferences), one
   key prefix per audience.
3. **An administrator is not signed in by the app.** A sign-in that resolves to TENANT_ADMIN,
   or meets an authenticator challenge, is signed out with a pointer to the web console.
4. **The app calls API Gateway directly**, with the access token, as the web does through its
   same-origin proxy. Its IDs come from `python tools/app_env.py`, passed with
   `--dart-define-from-file`.
5. **Google sign-in for patients follows as its own screen**, through the hosted UI and the
   system browser, when that screen is built.

## Consequences

The app depends on a community library rather than AWS's own. It is small, maintained, and
behind the `Auth` interface, so replacing it touches one file. The demo build
(`ATRIA_DEMO=true`) swaps in a stand-in for both `Auth` and the API.
