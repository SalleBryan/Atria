# 0018. Where the password rules live

Status: accepted
Source: project, from verifying FR-ACC-05 against the deployed pool (`tools/smoke_passwords.py`)

## Context

FR-ACC-05 asks for passwords of at least 12 characters, with upper and lower case letters and
"a number or symbol", and a first-sign-in password that differs from the temporary one.

The user pool enforces length and case. It cannot state the rest exactly:

- Cognito's policy has separate switches for numbers and for symbols. It has no rule for
  "one or the other".
- On the Essentials feature plan, Cognito does not compare the new password with the temporary
  one. Checked on 2026-09-23: the temporary password offered back at the forced change was
  accepted. Password history, which would refuse it, is only on the Plus plan.

Neither gap can be closed on the server within Essentials. No trigger sees a password.

## Decision

1. **The pool requires a number.** This is stricter than FR-ACC-05: a password with a symbol and
   no number is refused. The rules shown on every sign-up, first sign-in and reset screen say
   "a number", so the screens and the pool agree.
2. **The first sign-in screen refuses the temporary password as the new one.** The screen has
   just been given the temporary password, so it compares the two before calling Cognito and
   explains the refusal. This is a client rule. Someone calling Cognito directly with the
   temporary password can still keep it. What that leaves them is a password they chose to
   keep and that an administrator issued only to them, still bound by the length and case rules.
3. **Move to the Plus plan when password history is wanted on the server**, for this and for
   reuse at later changes. That is a cost and plan decision for the tenant, not part of Phase 1.

## Consequences

- `tools/smoke_passwords.py` scores what the pool enforces and reports both differences
  separately, so a change in Cognito's behaviour shows up there.
- The web client's first sign-in screen owns the rule in point 2, and its tests must cover it.
  Until that screen exists, point 2 is not met anywhere. Phase 1 counts FR-ACC-05 as met only
  once it is.
- The staff invitation email must tell the recipient that the temporary password cannot be kept.
