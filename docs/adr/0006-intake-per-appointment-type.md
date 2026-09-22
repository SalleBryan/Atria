# 0006. Intake per appointment type

Status: accepted
Source: AD-06 in the Technical Document (ATR-TD-001, section 3)

Constraints: C-03 personal data law

## Decision

Each type carries its own intake form. Answers are stored as care context: a separate entity,
encrypted under its own key, readable only by the patient and the assigned clinician, and purged
sooner than booking history.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
