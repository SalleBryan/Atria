/**
 * Choosing a new password: the field, a strength bar, a confirmation field
 * and the checklist of rules, from "Desktop · First sign-in" (60:3). The
 * password reset uses the same block, so the two screens can never disagree
 * about the rules.
 */

import { passwordRules, type Rule } from "../auth/passwordRules";
import { Field } from "./controls";
import { Check, Lock } from "./icons";

export function NewPassword({
  password,
  confirm,
  onPassword,
  onConfirm,
  temporary,
  mismatch,
}: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  /** The temporary password, on a first sign-in only (ADR 0018). */
  temporary?: string;
  mismatch?: boolean;
}) {
  const rules = passwordRules(password, temporary);
  const strength = rules.filter((rule) => rule.met).length;
  return (
    <>
      <Field
        label="New password"
        icon={Lock}
        type="password"
        autoComplete="new-password"
        placeholder="At least 12 characters"
        revealable
        value={password}
        onChange={(event) => onPassword(event.target.value)}
        className="field-tight"
      />
      <div className="strength" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={index < Math.round((strength / rules.length) * 4) ? "on" : ""} />
        ))}
      </div>
      <Field
        label="Confirm new password"
        icon={Lock}
        type="password"
        autoComplete="new-password"
        placeholder="Type it again"
        value={confirm}
        onChange={(event) => onConfirm(event.target.value)}
        error={mismatch ? "The two passwords do not match." : undefined}
      />
      <RuleList rules={rules} />
    </>
  );
}

export function RuleList({ rules }: { rules: readonly Rule[] }) {
  return (
    <ul className="rules" aria-label="Password rules">
      {rules.map((rule) => (
        <li key={rule.id} className={`rule${rule.met ? " rule-met" : ""}`}>
          <span className="rule-dot" aria-hidden="true">
            <Check size={11} />
          </span>
          {rule.label}
          <span className="visually-hidden">{rule.met ? ", met" : ", not met yet"}</span>
        </li>
      ))}
    </ul>
  );
}
