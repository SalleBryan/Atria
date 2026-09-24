/**
 * The password rules as the screens show them (FR-ACC-05, ADR 0018).
 *
 * The user pool enforces the first three. It asks for a number where the
 * requirement also allows a symbol, because Cognito cannot state "one or the
 * other", so the screens say "a number" and agree with the pool.
 *
 * The last rule, that the new password is not the temporary one, Cognito does
 * not check at all on its current plan. This screen is where it is enforced.
 */

export const MIN_LENGTH = 12;

export interface Rule {
  readonly id: "length" | "case" | "number" | "not-temporary";
  readonly label: string;
  readonly met: boolean;
}

export function passwordRules(password: string, temporary?: string): Rule[] {
  const rules: Rule[] = [
    { id: "length", label: `At least ${MIN_LENGTH} characters`, met: password.length >= MIN_LENGTH },
    {
      id: "case",
      label: "Upper and lower case letters",
      met: /\p{Lu}/u.test(password) && /\p{Ll}/u.test(password),
    },
    { id: "number", label: "A number", met: /\d/.test(password) },
  ];
  if (temporary !== undefined) {
    rules.push({
      id: "not-temporary",
      label: "Not the temporary password you were sent",
      met: password.length > 0 && password !== temporary,
    });
  }
  return rules;
}

export function allMet(rules: readonly Rule[]): boolean {
  return rules.every((rule) => rule.met);
}
