# Pain lane log

Append status notes here. Only the pain lane edits this file.

## 2026-11-13
- Merged: PR 20 (audit fixes F01, F03, F10 and wording; Flutter pinned), PR 21 (handoff, reference library, CLAUDE.md, ADR 0022).
- Queue slice 1 (`pain/queue-revision`): `next_call` rules with tests (never idle, bounded bypass, hold, late, urgent), call preview, per-ticket flags. Rules are settings by level: tenant, unit, session. New permissions `queue.configure`, `queue.tune_session`; new routes `PATCH /clinics/{id}/queue-policy` and `PATCH /sessions/{id}/policy`; tenant fields `queueHoldMinutes`, `queueLateGraceMinutes`, `queueMaxBypass`.
- Files this lane owns: `core/queue.py`, `services/booking/queue.py`, `data/sessions.py`, ticket fields. Business lane: ask here before editing them.
- Next: slice 2 (desk console and settings screens), then slice 3 (invitations).

## 2026-11-13 (later)
- PR 22 opened (queue slice 1), CI green. PR 20 Deploy succeeded.
- Owner decision: only the receptionist may mark a ticket urgent. Recorded in ADR 0022 R6 and the handoff. Slice 2 will add `queue.mark_urgent` (receptionist only) and the route; slice 2 starts after PR 22 merges.
