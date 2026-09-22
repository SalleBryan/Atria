# 0009. Date of birth and a verified phone

Status: accepted
Source: AD-09 in the Technical Document (ATR-TD-001, section 3)

Constraints: C-03 personal data law

## Decision

Every patient confirms a Complete your profile step whatever the identity provider returns. Date
of birth is stored, age is derived. The phone is verified by one-time code. Under 18 requires a
linked guardian with recorded consent.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
