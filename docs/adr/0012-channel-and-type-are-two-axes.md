# 0012. Channel and type are two axes

Status: accepted
Source: AD-12 in the Technical Document (ATR-TD-001, section 3)

## Decision

Every booking records how it reached the clinic (online, walk-in, phone, referral) separately
from what is booked. Referral opens referring facility and clinician fields and restricts the
types to specialist and procedure.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
