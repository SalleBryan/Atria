# 0030. Commercial scope moves into Phase 3

Status: proposed (needs the owner's approval before any plan record, invoice or billing code)
Constraints: C-02 fees and conduct, CX-12 no currency savings claim, AD-07 fee ledger without moving money, AD-11 ratings stay off prices
Lane: business lane

## Context

The SRS (Rev B) puts tenant onboarding commercial terms, per-tenant branding and billing out of scope (FR-TEN-03, section 1.2), and says no payment, card entry, wallet or settlement function exists before Phase 3 (FR-MSR-07). The pitch closes on a measured baseline per clinic and then a facility subscription with a message bundle. The pitch cannot be made real in code while the SRS forbids it, and the code must not run ahead of the SRS.

No verified Cameroon SMS tariff, willingness to pay, signed carrier rate or competitor subscription price exists (evidence report, section 6.3). Any price in code or copy would be invented.

## Decision (proposed)

1. **Reporting is not commercial scope and is not blocked.** The usage statement (ADR 0031) and the baseline report with a before and after comparison are measurement under FR-MSG and FR-MSR. They carry no price, no invoice and no claim of savings.
2. **Commercial records move into Phase 3**, as records only: a read only tenant plan record and a generated usage or invoice document. FR-TEN-03 is amended to say so in the next SRS revision (the owner issues it; the PDFs under `docs/reference/specifications/` are not edited by the business lane).
3. **Atria moves no money.** Payment, mobile money and settlement stay out until the owner decides, separately, that Phase 3 payments begin (FR-MSR-07).
4. **No price is written anywhere** until the three conversations in the evidence report close it: a hospital manager, an SMS aggregator, a district health office. A plan record holds a name and a period, with the amount left for the owner to enter.
5. **Cross-tenant billing needs a platform operator concept** above TENANT_ADMIN. That is a spec change (`spec/atria_spec/roles.py`) and a separate decision. Until then each tenant sees only its own records.
6. **Ratings never touch prices** (AD-11) and the settings added by the queue revision (ADR 0022) are configuration, not plan tiers.

## Consequences

Nothing is built under points 2 to 5 until the owner approves this record. B3 (plan card and invoice document) and anything touching a plan or an amount waits. B4 (onboarding checklist) reuses the existing importers and needs no commercial scope.

## Open questions for the owner

1. Approve moving the plan record and invoice document into Phase 3, as records only?
2. Should the SRS FR-TEN-03 text change in Rev C now, or when B3 starts?
3. Is a platform operator role wanted, or does each tenant stay self contained for the pilot?
