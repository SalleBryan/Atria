# 0017. The person item summarises its memberships

Status: accepted
Source: project decision, 2026-09-22

## Decision

The person item carries a short summary of the person's staff memberships and
patient profiles, alongside the membership records themselves. The membership
record stays the source of truth; the summary exists so the sign-in path can
resolve the whole caller from one read.

Both are written in the same transaction, so they cannot drift apart.

The alternative was a sixth index on `personId`. That would add an index, and a
query, to the hottest path in the system in order to answer a question that is
only ever asked about one person at a time.

## Consequences

The pre-token generation trigger reads the person item once by `cognitoSub` on
the `PersonIndex` and writes the tenant, person, roles, staff membership, clinic
and patient profile into the token as claims. The API authoriser therefore needs
no table access at all: it verifies the token and reads the claims, which keeps
the per-request path to one Lambda and no query.

It also means a change to roles, a clinic or a status reaches a signed-in
session only at its next sign-in, which is what the specification already says
about roles (ADR 0015). Anything that must take effect immediately cannot live
in the token and has to be read per request by the service that needs it.

Every write that changes a membership must update the person summary in the same
transaction. `atria.data.people` is the only module that writes either, so that
rule has one place to live.
