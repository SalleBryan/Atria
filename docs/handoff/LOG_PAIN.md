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

## 2026-11-13 (slice 2)
- Branch `pain/queue-desk`: desk console for the queue rules (guard, hold countdown, override with reason, urgent marking, markers), rules dialogs at session and unit level, tenant defaults in Settings, `GET /clinics/{id}/queue-policy`, audit routes for the policy routes, dev preview persona `opd-manager`.
- Queue-quality metrics can be built from existing ticket stamps and `bypassCount`, `lateAt`, `urgent`; no new event is needed.
- Next: patient live ticket view, voice and local-language reminders, fee in reminders.
- Pain lane split between Claude (P1 to P3) and Codex (X1 to X4) is in the handoff, section 1. Codex notes go under a "Codex" heading below; requests for Claude's files go under "Codex requests".

## Codex

## Codex requests

## 2026-11-13 (live ticket)
- Branch `pain/live-ticket` (stacked on `pain/queue-desk`): `GET /appointments/{id}/ticket`, `core/queue.py::outlook`, patient ticket screen shows patients ahead and the likely time, refreshed every 30 seconds. Added X5 (Flutter patient screen) to the Codex list.
- Checked Codex: five local worktrees, nothing committed or pushed, no Codex log entry. Status table and the split of the unclaimed audit items are in the handoff, section 1, "Where Codex ended". F16, F15 stay with Claude; F04, F13, F08, F14, F12 and the usage and comparison screens are proposed to the business lane.

## 2026-11-13 (Codex left)
- Codex is no longer working on the repo; the two Claude accounts split what is left (handoff, section 1, "Who does what now"). Its unfinished edits were saved as patches outside the repo and are to be adopted only after review and the full CI set. The "Codex" headings above are history.
