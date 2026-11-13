# 0022. The doctor never idles, and a promise is never skipped

Status: accepted 2026-11-13 by the owner. Built in slices: (1) rules and the call; (2) desk console guard and urgent marking; (3) early-call invitations, messages and tenant settings.
Constraints: C-01 staffing, C-04 connectivity, AD-02 book a place in a session, AD-10 fair queues
Lane: pain lane (pain point 1, waiting without knowing)

## Context

The general consultation line is one ordered queue per session. Online patients and walk-ins registered at
the desk are the same list (FR-BKG-13). A ticket has a server-assigned position and an arrival window that is
recalculated as the session runs. Today `call_next` (`backend/src/atria/services/booking/queue.py`) takes the first
ticket in position order whose state is ARRIVED, so a doctor already skips patients who are not at the hospital.

The owner's concern: general consultations are about 30 minutes, a doctor often finishes early, and the doctor
must not sit idle while someone is waiting on site. At the same time, a patient who booked online and turns up on
time must not be pushed back because an on-site patient was fitted into the gap. The doctor is the processor and the
patients are the jobs, but these are people, so fairness is part of correctness.

The owner's first proposal: when the doctor finishes early, notify the patient booked for the next slot and ask if
they want to move up; wait 5 minutes; with no reply or a no, let the receptionist move an on-site patient in.

## Critique of that proposal

1. **The 5 minute wait idles the doctor.** The patient who was asked is, by definition, not on site: if they were,
   they would already be ARRIVED and `call_next` would take them. Five minutes of waiting for someone who is probably
   at home is five minutes of idle doctor, which is the exact failure the rule exists to prevent.
2. **The question asks permission for the wrong thing.** An online patient does not need to consent to an on-site
   patient being seen while they are absent. What helps them is an invitation to come earlier, not a veto.
3. **Fixed 30 minute slots are not the model.** Atria does not promise a minute for general consultations (C-01, AD-02).
   A place has an arrival window, not an appointment time. Keep it that way: a slot model would break the first time
   a doctor runs late or early, which is every day. Specialist visits keep timed slots.
4. **The case "the 10:30 patient arrives and the doctor is busy with the gap filler" is real** and needs a rule, not
   only a hope that it is rare.
5. **Clinical priority is missing.** A health queue needs an urgency override that outranks both online and on-site order.

## Decision

Work-conserving with bounded bypass: never leave a doctor idle when someone is present, never let a patient who is
present and on time be bypassed more than once, and send invitations in parallel without ever holding the doctor.

### Rules

- **R1, non-idling.** When a doctor is free and at least one ticket is ARRIVED, the doctor takes the earliest-position
  ARRIVED ticket now. No waiting on a reply. (This is today's behaviour; keep it.)
- **R2, due and absent.** A ticket is *due* when its arrival window has opened. A due ticket that is not ARRIVED is
  *absent*. Each absent due ticket has a `bypassCount`: the number of consultations that started while it was absent.
  A walk-in or later ticket may be called ahead of an absent due ticket only while that ticket's `bypassCount` is 0.
  After one bypass the next free doctor is held for that ticket for `holdMinutes` (default 5, tenant setting) while the
  desk phones them; if nobody present is waiting the hold costs nothing. This bounds the harm to one consultation.
- **R3, late means rejoin.** If a due ticket is still absent `lateGraceMinutes` after its window ends (default 15), it
  becomes LATE. On arrival a LATE ticket rejoins by arrival time, behind everyone already present. Lateness forfeits
  priority, which is the airport rule for a missed boarding group.
- **R4, early-call invitation (parallel, never blocking).** When the system predicts a doctor will be free within
  `inviteLeadMinutes` (default 5) and nobody is ARRIVED, it invites the next K (default 3) absent tickets by position:
  "A doctor is free sooner. Can you be here within 20 minutes? Reply YES." A YES records an ETA and moves nothing by
  itself. If an on-site patient exists the doctor takes them immediately (R1); the invited patient simply arrives to a
  shorter wait and goes next. An invitation never reorders the queue.
- **R5, gap-filler guard (decision support for the desk).** Before the desk pulls an on-site patient ahead of an absent
  due ticket, the console shows: who is bypassed, minutes to their window end, and the expected length of this
  consultation (median of this unit's recent consultations of the type). If the expected end is later than the bypassed
  ticket's window end, the console warns and requires a one-tap confirm. Never blocked, always audited.
- **R6, urgency override.** Only a receptionist may mark a ticket URGENT, with a reason (owner's decision, 2026-11-13: the
  desk sees who arrives and judges urgency; clinicians and managers cannot). It outranks position, is audited, and is not
  counted as a bypass against others. Permission `queue.mark_urgent`, receptionist at clinic scope, nobody else. Staff priority
  otherwise exists only as a granted quota (ADR 0010); do not add another path.
- **R7, the queue moves up for everyone.** Early finishes shorten every later estimate. Recalculate windows from the
  measured consultation length, not a fixed 30 minutes, and text a patient only when their window moves by more than
  the tenant threshold (existing behaviour, `moved_enough`).

### Why this is fair

Fairness is defined as: **you are seen when you were promised, if you are there.** Order among present patients is by
position (R1). Absence costs a patient at most one bypass while due (R2), then the doctor waits for them for a bounded
time. Lateness is the patient's own cost (R3). An early finisher benefits everyone behind it (R7). The worst case for
an on-time patient is the remaining time of one consultation that began while they were absent, and the desk sees that
cost before choosing (R5).

### Data (proposal; check `spec/atria_spec/lifecycle.py` and `keys.py` first)
As built in slice 1: ticket (appointment) fields `bypassCount`, `holdStartedAt`, `lateAt`, `urgent`, and on the consultation
`bypassedAppointmentIds` and `bypassOverrideReason`. Consultation length is derived from the existing `consultationStartedAt`
and `completedAt` stamps, so no new event is needed for it. Still to come: `urgentReason`, `inviteReplyAt`, `inviteEta` and the
invitation events. `core/queue.py::next_call` is the one pure function that decides who is called; `services/booking/queue.py`
only persists its decision.
Settings by level, never constants. `core/queue.py::resolve_policy` merges, most specific winning per knob:
session (the desk, for the day, `PATCH /sessions/{id}/policy`, permission `queue.tune_session`: receptionist and unit
manager), unit (`PATCH /clinics/{id}/queue-policy`, permission `queue.configure`: unit manager for their unit,
administrator for any), tenant (administrator, through `PATCH /admin/settings`: `queueHoldMinutes`,
`queueLateGraceMinutes`, `queueMaxBypass`), then the built-in fallback (hold 5, late grace 15, bypass 1). Limits: hold 0
to 30 (0 never holds), late grace 0 to 60, bypass 0 to 3 (0 holds at once). `null` clears an override. The live queue
returns the policy in force with the level that set each knob. Slice 3 adds four knobs on the same three levels:
`inviteLeadMinutes` (0 to 30, default 5), `inviteFanout` (0 to 10, default 3, 0 sends none), `inviteOpenMinutes`
(5 to 120, default 20: how long an invitation is open and the time the patient is asked to arrive within) and
`earlyCallInvites` (`desk` or `auto`, default `desk`). Tenant fields are `queueInviteLeadMinutes`, `queueInviteFanout`,
`queueInviteOpenMinutes` and `queueEarlyCallInvites`. The fallback is `desk` because every invitation is a metered
message and production SMS is not switched on yet; the administrator may choose `auto`.
Invitation state lives on the ticket: `inviteSentAt`, `inviteExpiresAt`, `inviteAnswer` (YES or NO), `inviteReplyAt`,
`inviteEta`. `core/queue.py::invite_targets` is the one pure function that says who may be invited now. A YES records
the patient's reply and an ETA and nothing else (R4 as written: it moves nothing by itself, so the doctor is never
sent for someone who is not here). The patient then arrives and is checked in as any arrival is.

### Messages
New kinds `EARLY_CALL_INVITE` and `QUEUE_MOVED` in `core/notices.py`. The invite is time critical, so prefer the push
or in-app channel and use SMS as the carrier. SMS can lag minutes, so the invite text says "within 20 minutes", not
"now". Reply by link or short code, not free text. English only until the language phase.

### Edge cases to cover in tests (name the requirement in each test)
Several doctors free at once (R2 per ticket, not per doctor); a bypassed patient who arrives mid-consultation; a LATE
patient arriving with nobody present; two absent due tickets; invite accepted but patient never arrives; session closes
with invites open; clock skew between the desk and the server (the server decides); a walk-in with the same phone as an
online ticket (existing register rules apply); URGENT while a doctor is mid-consultation (never interrupt; next call only).

## Alternatives considered
- **Hold the doctor for the next booked patient (the original 5 minutes).** Rejected: idles the doctor for an absent
  patient.
- **Strict FIFO by position, no bypass.** Rejected: idles the doctor whenever an early ticket is absent.
- **Fixed per patient slots for general consultations.** Rejected: contradicts C-01 and AD-02.
- **Reserve a share of each session for walk-ins (carve-out), release unused places to online later.** Valid and
  common for mixed access, but it changes capacity derivation (`core/queue.py::capacity`). Deferred to a later ADR;
  note it as a tenant setting candidate.
- Patterns from airports (standby lists, missed boarding group rejoins last), banks and outpatient clinics (walk-ins
  fill gaps behind a punctuality promise) informed R2 and R3. No literature search was run for this ADR: verify before
  citing any of it in the pitch.

## Business model impact (for the business lane)
- **Metrics become the product's proof.** Doctor idle minutes, wait from arrival to consultation, promise breach
  minutes (consultation start minus window end, for patients who arrived in their window), bypass rate, on-site versus
  online mix. These belong in the baseline report (B2). Report them without any currency claim (FR-MSR-04, CX-12).
- **Message volume rises.** Invitations and moved-up notices add messages per visit. Meter them by kind (B1) so a usage
  statement can show them. Never price from invented per-message rates.
- **Settings multiply.** Five tenant settings and a possible walk-in reserve share are configuration, not a pricing tier.
  Do not tie them to plans before the owner decides commercial scope (B0, FR-TEN-03).
- **Time-critical delivery raises the value of production SMS and push** (OI-04 and the Firebase setup are owner actions).

## Open questions for the owner
1. (Answered 2026-11-13: these are settings by level, not constants.) Which built-in fallbacks for invitations: lead 5, fan-out 3?
2. May a patient decline an invitation, and does a decline change anything? (Proposed: no effect on position.)
3. (Answered 2026-11-13: the receptionist only.)
4. Is the walk-in reserve share wanted now or later?
5. Which unit pilots this first? Its measured consultation length seeds R5.

## Consequences
Implementation consequences to be recorded as the code lands, with the pull requests that establish them. Update
`docs/openapi/atria.yaml`, the lifecycle in `spec/`, and the SRS requirement text in the same pull requests.
