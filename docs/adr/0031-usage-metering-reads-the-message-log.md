# 0031. Usage metering reads the message log

Status: accepted (reporting only; nothing here is billing)
Source: business lane B1
Constraints: CX-12 no currency savings claim, FR-MSR-04

## Decision

`GET /messages/usage?month=YYYY-MM` counts the message log rows that settled in a month on the tenant's clock, by unit, kind, channel and state. It is the administrator's (`message.read` at tenant scope) and reads the same `MessageDayIndex` the delivery figures use. The arithmetic is pure, in `core/usage.py`.

## Consequences

- A row counts once, in the state it settled in. A reminder still waiting has no settled day, so it is not counted until it goes.
- No price, spend or rate is stated. SMS spend as SNS reported it stays on the delivery figures.
- New kinds from the queue revision (`EARLY_CALL_INVITE`, `QUEUE_MOVED`) appear in `byKind` with no code change.
- A month is at most 31 days, so a request reads at most 33 index days.
- A priced statement or an invoice is ADR 0030 territory and waits for the owner.
