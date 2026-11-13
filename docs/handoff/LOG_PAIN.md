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

## 2026-11-13 (offline and network-failure recovery, scope note)
Branch `pain/offline-recovery` (web only; Flutter is deferred by the owner). Audit F16, with F15 only if a small safe win appears.

Will do:
- One place that classifies a failed request (`web/src/api/network.ts`, `client.ts`): no connection, server trouble, conflict, refused, other. Plain words for each. A gateway error page is no longer a JSON parse crash.
- A connection banner in the patient and staff shells (reuses `Notice` and the M3 springs): says the screen may be out of date and that nothing is sent until the connection returns. "Back online" in a `Snackbar`.
- Polling that pauses when the device is offline or the tab is hidden, resumes with an immediate read, backs off after failures, and says "as of HH:MM" when it shows an old value (patient live ticket, staff queue hook-in of two lines).
- Idempotent reads (GET) retry twice with backoff; nothing else is ever retried by the client. Mutations: manual Retry only.
- Failed submissions keep what the person chose or typed (booking, join queue, procedure request, new-time offer) and say whether the outcome is unknown. `NewTimeOffer` stops calling every error "just taken": only a 409 does.
- A Retry on the initial patient load failure, and an automatic reload when the connection returns.
- Dev preview switch (`window.__atriaNetwork`) so offline can be simulated without devtools.

Will not do:
- No offline shell, no service worker fetch handler, no queued mutations, no storing visit data on the device (F16 says minimise retained sensitive data; a stale cached shell after a deploy is its own risk). Recorded as a follow-up decision for the owner.
- No new backend idempotency: only `POST /appointments` honours `Idempotency-Key` today. Tickets, procedure requests, reschedule and cancel stay manual-retry only; making them idempotent is a backend follow-up.
- Polling cadence (30 seconds) and backoff stay client fallbacks, not hospital policy; no setting added. Flutter parity later.
- `web/src/staff/Queue.tsx`: only the polling line, another session is changing that file.

## 2026-11-13 (offline and network-failure recovery, built)
Branch `pain/offline-recovery`, web only. Audit F16 done for the web client; F15 recorded, not built.
- `web/src/api/client.ts`: a request that gets no answer is an `ApiError` with status 0 and `outcomeUnknown` (true for a write that left the device, a 502 or 504 on a write). A gateway HTML page no longer crashes JSON parsing. Only GETs are asked again (two more tries, 600 ms then 1.8 s, never while the device is offline); no write is ever repeated by the client.
- `web/src/api/failure.ts`: `describeFailure` sorts offline, server, conflict, refused, other and words each in plain English, with "we cannot tell whether it went through" for an unknown outcome.
- `web/src/api/network.ts`: `useConnection` (device offline, Atria unreachable, or online), `useOnReconnect`, and `startPolling` (pauses offline and in a hidden tab, reads at once on return, doubles the wait after each failure up to 8x).
- `ConnectionBanner` in both shells (floats, no layout shift, polite announcement, "Try now" does a real check, "Back online" snackbar). `Notice` gained optional `role` and `className`.
- Patient live ticket polls through `startPolling`, keeps the last place and says when it was last updated if a refresh fails. Staff queue: two lines (`startPolling(load, 30000)`), nothing else in `Queue.tsx`.
- Forms keep what was typed or chosen: booking (same Idempotency-Key on retry, so it cannot book twice; the intake questionnaire stays open with its answers), join queue and procedure request (no longer say "no place was taken" when that is not known), new-time offer (only a 409 means "just taken"; a drop keeps every offered time and offers "Check my visit"; unreadable times say so with Try again). The patient data provider keeps stale data when a reload fails and reloads when the connection returns; Find care and My visits show Try again.
- Dev preview: `window.__atriaNetwork = "down" | "slow"` makes the mock API behave like a dead or slow connection.
- Verified in the preview (port 5180, because another session holds 5173): patient `/visits` and `/find-care` at 1280x720 and 390 wide, staff `?as=opd` queue at both sizes; banner, "Back online", booking drop with the questionnaire answers kept, 0 queue reads in 42 s offline and an immediate read on return. Not verified: a real throttled or flaky network, a real device, the patient live ticket in the preview (the mock unit has no queue; covered by unit tests), screen readers.
- Decisions left for the owner: (1) whether to cache an offline app shell with a service worker (F16 asks for minimal retained data; a stale shell after a deploy is a risk), (2) idempotency keys for tickets, procedure requests, reschedule and cancel (backend; today only `POST /appointments` has them), (3) whether the poll interval and backoff should become a setting.
- F15: measured with this branch, main chunk 1,949 kB (586 kB gzip), `exceljs` already its own 929 kB chunk loaded on export, jsPDF's html2canvas and purify already split. The remaining win is route level `lazy()` for `staff/routes.tsx` and `patient/routes.tsx` plus a Suspense in the two shells. Not done: about 15 tests render `staffRoutes` synchronously and a first lazy import in jsdom can exceed their 1 s waits, and `Reports.tsx` and `StaffAccounts.tsx` are business lane hotspots. Own PR, with a bundle budget for the patient entry path.

## 2026-11-13 (slice 3, PR 1 of 4)
- Branch `pain/early-call`: pure invitation rules and settings. `core/queue.py`: `Policy` gains `invite_lead_minutes`, `invite_fanout`, `invite_open_minutes`, `early_call_invites`; `resolve_policy` and `policy_changes` handle them (one is a word, desk or auto); `invite_status`, `doctor_free_within`, `invite_targets` are the new pure functions. Tenant fields `queueInviteLeadMinutes`, `queueInviteFanout`, `queueInviteOpenMinutes`, `queueEarlyCallInvites` in `core/settings.py` and `services/admin/settings.py`; unit `queuePolicy` and session `policy` take the short names. `policy_view` returns them. Nothing sends anything yet.
- Decision to confirm: ADR 0022 R4 says a YES records an ETA and moves nothing, the task brief said a YES checks the patient in. The ADR wins, so a YES will not check anyone in; the patient arrives and checks in normally. The fallback for `earlyCallInvites` is `desk`.
- Next: PR 2 the `EARLY_CALL_INVITE` notice, sender and outbox; PR 3 the desk invite route and the patient reply route; PR 4 the desk screen and the settings fields.

## 2026-11-13 (slice 3, PR 2 of 4)
- Branch `pain/early-call-notice` (stacked on `pain/early-call`): `EARLY_CALL_INVITE` is a new message kind, SMS only, one segment, plain ASCII, English and French wording (French stays off behind `OFFERED`). Added to `core/notices.py` (`KINDS`, `SMS_TEXT`, `invite_minutes`), `services/notify/outbox.py` (an `inviteSentAt` written on a waiting ticket owes one SMS), `services/notify/sender.py` (still true only while the ticket is waiting and the invitation is open and unanswered; it pushes itself) and the web message log label. The message log row carries the kind, so the business lane's metering counts it with no change.
- Not touched: `language_for`, `OFFERED`, Flutter (the `oversight.dart` kind label is left for the Flutter slice).

## 2026-11-13 (slice 3, PR 3 of 4)
- Branch `pain/early-call-routes` (stacked on `pain/early-call-notice`): `POST /sessions/{id}/invites` (permission `queue.invite`: receptionist and unit manager, clinic scope) and `POST /appointments/{id}/invite-reply` (`queue.reply_invite`: the patient for their own place, the receptionist for a reply given by phone). Spec first, regenerated. Both are in `http/audit.py`, `infra/.../api.py` (an `invites` resource and the `invite-reply` visit action) with `infra/tests/test_stacks.py`, and `docs/openapi/atria.yaml`.
- The live queue now returns `invites` (mode, fan-out, open count, eligible tickets) and an `invite` object per ticket; the patient's `GET /appointments/{id}/ticket` returns their own `invite`. In `auto` mode the invitations go out when the desk's live queue is read and after a call (there is no scheduler yet, so they do not go out with the desk closed). Not verified against real SMS: MTN is not wired and SMS is in the AWS sandbox.
- A YES records the reply and an ETA only; it does not check the patient in (ADR 0022 R4).

## 2026-11-13 (fee on the desk)
- Branch `pain/desk-fee` from `origin/main`: the live queue shows the fee each place will be asked for ("Fee 5,000 XAF", "Free", nothing when the type has no band) and the walk-in dialog states the walk-in fee. Backend `FeeLookup` (one band read per type, band in force on the session date). Touched `services/booking/queue.py` only in `live_queue` and a small `walk_in_fee` helper, plus the queue view in `Queue.tsx`, so the early-call work should rebase cleanly.
- `pain/fee-in-reminders` was not merged yet (its work was uncommitted in another worktree). To avoid two copies of the band logic, that branch should call `FeeLookup` instead of its own `appointment_fee` lookup when it rebases.
- Not done: Flutter desk (deferred by the owner).
