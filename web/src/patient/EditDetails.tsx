/**
 * Changing one's own details (2026-09-28): the name and language through
 * PATCH /me, the email through Cognito's own code and then POST /me/email,
 * which takes the address only once Cognito has verified it. The mobile
 * changes by one-time code, which comes with SMS verification.
 *
 * Built from the platform's parts: the sign-in fields, the picker, the six
 * code boxes and the M3 loading indicator.
 */

import { confirmUserAttribute, updateUserAttribute } from "aws-amplify/auth";
import { type FormEvent, useState } from "react";

import { api } from "../api/client";
import { messageFor } from "../auth/errors";
import { useSession } from "../auth/session";
import { CodeInput, isComplete } from "../components/CodeInput";
import { Field, Notice } from "../components/controls";
import { Mail, User } from "../components/icons";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { SelectMenu } from "../components/Pickers";
import { languageName } from "./data";

type Editing = null | "name" | "language" | "email";

export function EditDetails({ editing, onDone }: { editing: Editing; onDone: (said: string | null) => void }) {
  const { state, refresh } = useSession();
  const me = state.status === "signed-in" ? state.me : undefined;
  const [given, setGiven] = useState(me?.givenName ?? "");
  const [family, setFamily] = useState(me?.familyName ?? "");
  const [language, setLanguage] = useState(me?.languages?.[0] ?? "en");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!me || !editing) return null;

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setFailure(null);
    try {
      const said = await work();
      await refresh("patient");
      onDone(said);
    } catch (caught) {
      setFailure(messageFor(caught));
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (editing === "name") {
      await run(async () => {
        await api("/me", { method: "PATCH", json: { givenName: given.trim(), familyName: family.trim() } });
        return "Your name is saved. The front desk sees it too.";
      });
    } else if (editing === "language") {
      await run(async () => {
        await api("/me", { method: "PATCH", json: { preferredLanguage: language } });
        return `Messages will come in ${languageName(language)}.`;
      });
    } else if (!codeSent) {
      setBusy(true);
      setFailure(null);
      try {
        await updateUserAttribute({ userAttribute: { attributeKey: "email", value: email.trim() } });
        setCodeSent(true);
      } catch (caught) {
        setFailure(messageFor(caught));
      } finally {
        setBusy(false);
      }
    } else {
      await run(async () => {
        await confirmUserAttribute({ userAttributeKey: "email", confirmationCode: code });
        await api("/me/email", { method: "POST" });
        return "Your new email is verified. Confirmations and receipts go there from now on.";
      });
    }
  }

  const ready =
    editing === "name"
      ? given.trim().length > 0 && family.trim().length > 0
      : editing === "language"
        ? true
        : codeSent
          ? isComplete(code)
          : /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <form className="inner-card settings-card edit-details" onSubmit={save} noValidate>
      {failure && <Notice tone="error">{failure}</Notice>}
      {editing === "name" && (
        <div className="edit-details-pair">
          <Field label="Given name" icon={User} value={given} onChange={(e) => setGiven(e.target.value)} autoComplete="given-name" />
          <Field label="Family name" icon={User} value={family} onChange={(e) => setFamily(e.target.value)} autoComplete="family-name" />
        </div>
      )}
      {editing === "language" && (
        <div className="field">
          <span className="field-label">Language</span>
          <SelectMenu
          label="Language"
          value={language}
          width={260}
          options={["en", "fr"].map((code) => ({ id: code, label: languageName(code) }))}
          onChange={setLanguage}
          />
        </div>
      )}
      {editing === "email" &&
        (codeSent ? (
          <>
            <p className="edit-details-note">
              We sent a six-digit code to <strong>{email.trim()}</strong>. Enter it to confirm the change.
            </p>
            <CodeInput value={code} onChange={setCode} label="Confirmation code" invalid={Boolean(failure)} />
          </>
        ) : (
          <Field
            label="New email address"
            icon={Mail}
            type="email"
            autoComplete="email"
            placeholder={me.email ?? "you@example.com"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ))}
      <div className="edit-details-actions">
        <button type="button" className="outline-button" disabled={busy} onClick={() => onDone(null)}>
          Keep as it was
        </button>
        <button type="submit" className="dock-button" disabled={!ready || busy} aria-busy={busy || undefined}>
          {busy && <LoadingIndicator size={20} label="Saving" />}
          {editing === "email" && !codeSent ? "Send the code" : busy ? "Saving" : "Save"}
        </button>
      </div>
    </form>
  );
}
