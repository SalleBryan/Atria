# 0004. Grid unit plus typed duration

Status: accepted
Source: AD-04 in the Technical Document (ATR-TD-001, section 3)

## Decision

The tenant sets a calendar grid unit (default 10 minutes) and every appointment type carries its
own duration and buffer in grid units. A booking locks N consecutive units in one transaction.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
