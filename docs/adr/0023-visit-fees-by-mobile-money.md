# 0023. Visit fees by mobile money

Status: accepted

Patients can pay a visit fee by MTN or Orange mobile money. The payer enters a
Cameroon mobile number and approves the prompt that Fapshi Direct Pay sends.
The amount comes from the fee band in force on the local day of the visit. A
payment cannot change the fee, and only a provider-confirmed collection of the
full amount counts as paid. The desk can see the status and the masked number.

This supersedes [ADR 0007](0007-fee-ledger-without-moving-money.md) for the
collection of visit fees. It does not change the existing fee ledger, refund
entitlement or settlement logic. Payment attempts have a separate store. Atria
claims the visit before sending a prompt, since Fapshi does not deduplicate
requests. Uncertain outcomes are reconciled against the existing attempt.

Development uses Fapshi's sandbox. Production requires its own activated
collection service, keys and webhook. Confirm Direct Pay eligibility with Fapshi
before enabling it for the intended merchant model, including any aggregation
of payments. Fapshi deducts 3% from collections, as described in its
[payment status documentation](https://docs.fapshi.com/en/api-reference/endpoint/payment-status).

See the [Fapshi runbook](../runbooks/fapshi-sandbox.md) for setup.
