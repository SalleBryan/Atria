# 0007. Fee ledger without moving money

Status: accepted
Source: AD-07 in the Technical Document (ATR-TD-001, section 3)

## Decision

Every appointment writes a ledger entry at closure with fee band, amount in XAF, outcome and
refund entitlement. Nothing settles until a payment provider is added. No-show strikes are
tenant-configurable and off by default.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
