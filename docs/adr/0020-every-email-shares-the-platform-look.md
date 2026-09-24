# 0020. Every email shares the platform's look

Status: accepted
Source: project, at the product owner's request that all emails carry the platform's theme

## Context

Atria sends email from two places. The notice sender sends the booking confirmation and the
cancellation (FR-MSG-01, FR-MSG-02) through SES. Cognito sends its own: the code that confirms
an email address, the code that resets a password, and a staff invitation. Both went out as
plain text, and Cognito's as a single line from its default template.

The screens are glass over a blue gradient. Email clients render neither backdrop blur nor, in
several cases, a stylesheet: Gmail ignores web fonts and some of `<style>`, and Outlook lays out
only tables. Cognito refuses a custom message longer than 20,000 characters, and fails the whole
operation, a sign-up included, when its trigger fails.

## Decision

1. **One layout, `backend/src/atria/core/mail.py`**, used by both senders. It keeps what
   survives an email client: the colours by value from `web/src/styles/tokens.css`, Outfit and
   Plus Jakarta Sans with Arial behind them, the blue hero with the frosted cells from the visit
   detail screen (slate for a cancellation, as a cancelled visit turns), the white inner card,
   the primary button and the code field. Layout is tables with inline styles. The page asks to
   be read in light mode.
2. **Cognito's emails come from a custom message trigger**,
   `atria.services.identity.custom_message`. It passes Cognito's `{####}` and `{username}`
   placeholders through untouched. On any failure, or a message over the limit, it returns the
   event unchanged and Cognito sends its default. A styled email is never worth a failed sign-up.
3. **Every email is sent as HTML and as text.** The booking wording is held as parts (subject,
   heading, rows, closing), and both bodies are written from the same parts, so they cannot say
   different things. Email French keeps its accents; only SMS is held to ASCII.
4. **The language is the person's**, from `preferredLanguage` for a notice and `locale` for
   Cognito, falling back to the region pack's default (French) for both.
5. **The mark and the buttons wait for the hosted site.** Email clients will not show SVG, so
   `tools/email_mark.py` draws the sidebar mark as `web/public/email/atria-mark.png`. An email
   loads it, and links into the app, from `Environment.app_url`. Until the site is hosted that
   is empty, and an email carries the wordmark alone and no button, rather than a link to a
   development server.
6. **The sender reads as "Atria".** SES checks the address; the inbox shows the name.

## Consequences

- A new email is a page built from `mail.py`'s helpers. Every value a helper is given is
  escaped, so a clinic or a person naming themselves cannot change the markup.
- Hosting the web client sets `app_url`, and the mark and buttons appear with no code change.
- Cognito still sends from its own address until the pool sends through SES, which needs SES
  production access: in the sandbox, SES would only reach verified addresses and patients could
  not sign up.
- A patient who has never chosen a language reads French, including one who signed up in the
  English interface, until sign-up records the interface language as the account's `locale`.
