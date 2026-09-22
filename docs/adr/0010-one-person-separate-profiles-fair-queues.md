# 0010. One person, separate profiles, fair queues

Status: accepted
Source: AD-10 in the Technical Document (ATR-TD-001, section 3)

## Decision

A person holds a patient profile and, separately, staff memberships. Staff scope is dropped when
the actor is the subject. Queue order is assigned by the server. Self-benefiting reschedules are
blocked, every staff reschedule is reasoned and audited, and staff priority exists only as a
granted quota.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
