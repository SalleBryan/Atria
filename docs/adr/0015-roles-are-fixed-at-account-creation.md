# 0015. Roles are fixed at account creation

Status: accepted
Source: AD-15 in the Technical Document (ATR-TD-001, section 3)

## Decision

A tenant administrator creates each staff account with its roles. A staff member signs in to
that account and receives exactly the permissions of its roles. There is no role switching in a
session; a person who is also a patient uses the patient app with a separate sign-in.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
