"""The general consultation queue: sessions, capacity, positions and arrival windows.

Pure rules (D-01, D-02, FR-BKG-10, FR-BKG-11, FR-BKG-13). A session is a block
of general consultation time a unit manager publishes with a date, a window
and how many doctors are rostered. Its capacity is never typed: it is the
window's hours times the doctors times the throughput one doctor manages in
an hour, which starts from a seeded estimate and is corrected from what the
unit's closed sessions actually achieved.

A ticket's position is the server's, from the order requests arrived in. The
arrival window it shows is where its turn is expected, given how many are
still ahead and the pace the session is keeping, and it is recalculated as the
session runs; a patient is texted only when the window moves by more than the
tenant's threshold, or they would be texted all morning.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

from atria.core import schedule
from atria.core.errors import Invalid

# General consultations one doctor sees in an hour before anything is measured:
# about fifteen minutes each, which is this project's assumption for an
# outpatient department, corrected by measurement from the first closed session.
SEEDED_THROUGHPUT_PER_HOUR = 4.0

# How wide an arrival window is: long enough to plan a journey around.
WINDOW = dt.timedelta(minutes=30)

# The states in which a ticket is still waiting its turn.
WAITING = ("BOOKED", "CONFIRMED", "RESCHEDULED")
# The states that are done with the queue, one way or another.
DONE = ("COMPLETED", "AWAITING_FEEDBACK", "NO_SHOW", "PATIENT_CANCELLED", "CLINIC_CANCELLED")

SESSION_STATES = ("OPEN", "RUNNING", "CLOSED")

MAX_ROSTERED = 20
MAX_SESSION_HOURS = 12


@dataclass(frozen=True, slots=True)
class SessionWindow:
    opens_at: dt.datetime
    closes_at: dt.datetime

    @property
    def hours(self) -> float:
        return (self.closes_at - self.opens_at).total_seconds() / 3600


def throughput(closed: list[dict[str, object]]) -> float:
    """Patients a doctor sees in an hour: the recent sessions' average, or the seed."""
    # A session where nobody was seen says nothing about the pace; it is left out.
    measured = [
        pace
        for pace in (float(str(s.get("actualThroughputPerHour") or 0)) for s in closed)
        if pace > 0
    ][-5:]
    if not measured:
        return SEEDED_THROUGHPUT_PER_HOUR
    return round(sum(measured) / len(measured), 2)


def capacity(window: SessionWindow, *, rostered: int, per_hour: float) -> int:
    """How many tickets a session can issue, derived and never typed (FR-BKG-10)."""
    return max(0, math.floor(window.hours * rostered * per_hour))


def validate_session(
    body: dict[str, object], *, zone: object, today: dt.date, minutes: int
) -> tuple[dt.date, str, str, int]:
    """A session to publish: its date, start, end and rostered doctors."""
    day = schedule.parse_date(body.get("date"), name="date")
    if day < today:
        raise Invalid("a session is published for today or later")
    if (day - today).days > 60:
        raise Invalid("a session is published at most 60 days ahead")
    hours = schedule.validate_hours(
        {
            "days": {
                str(day.weekday()): {"start": body.get("startTime"), "end": body.get("endTime")}
            }
        },
        minutes=minutes,
    )
    start, end = hours[day.weekday()]
    span = (_minutes(end) - _minutes(start)) / 60
    if span > MAX_SESSION_HOURS:
        raise Invalid(f"a session is at most {MAX_SESSION_HOURS} hours")
    rostered = body.get("rosteredClinicianCount")
    if (
        isinstance(rostered, bool)
        or not isinstance(rostered, int)
        or not 1 <= rostered <= MAX_ROSTERED
    ):
        raise Invalid(f"rosteredClinicianCount is a whole number from 1 to {MAX_ROSTERED}")
    return day, start, end, rostered


def _minutes(clock: str) -> int:
    return int(clock[:2]) * 60 + int(clock[3:5])


def expected_start(
    window: SessionWindow, *, ahead: int, rostered: int, per_hour: float, now: dt.datetime
) -> dt.datetime:
    """When a ticket's turn is expected, with `ahead` still waiting before it."""
    rate = max(0.1, rostered * per_hour)  # patients an hour across the session
    begin = max(window.opens_at, now)
    return begin + dt.timedelta(hours=ahead / rate)


def arrival_window(start: dt.datetime, *, minutes: int = 5) -> tuple[dt.datetime, dt.datetime]:
    """A window beginning a little before the expected turn, on a round five minutes."""
    early = start - dt.timedelta(minutes=10)
    floored = early.replace(second=0, microsecond=0)
    floored -= dt.timedelta(minutes=floored.minute % minutes)
    return floored, floored + WINDOW


def moved_enough(old: str | None, new: dt.datetime, *, threshold_minutes: int) -> bool:
    """Whether a window has moved far enough to text the patient about it."""
    if not old:
        return True
    was = dt.datetime.fromisoformat(old.replace("Z", "+00:00"))
    return abs((new - was).total_seconds()) >= threshold_minutes * 60


def actual_throughput(
    tickets: list[dict[str, object]],
    *,
    window: SessionWindow,
    rostered: int,
    closed_at: dt.datetime,
) -> float:
    """What the session achieved per doctor per hour, written at close (FR-BKG-13)."""
    seen = sum(1 for t in tickets if t.get("state") in ("COMPLETED", "AWAITING_FEEDBACK"))
    hours = max(0.25, (min(closed_at, window.closes_at) - window.opens_at).total_seconds() / 3600)
    return round(seen / (hours * max(1, rostered)), 2)


# ------------------------------------------------- who is called next (ADR 0022)
#
# Work-conserving with bounded bypass. A doctor who is free takes the earliest
# patient who is here (R1). A patient whose arrival window has opened and who is
# not here is "due and absent"; a later ticket may be called ahead of them once
# (R2). After that the next free doctor is held for them for a few minutes while
# the desk phones; if they still do not come, they are late and rejoin behind
# everyone who is present when they do arrive (R3). A clinician or the desk can
# mark a ticket urgent, which outranks position and costs nobody a bypass (R6).


@dataclass(frozen=True, slots=True)
class Policy:
    """The knobs of ADR 0022. These are the fallbacks; three levels of settings override them."""

    hold_minutes: int = 5
    late_grace_minutes: int = 15
    max_bypass: int = 1
    # Early-call invitations (R4): how soon before a doctor is free to invite,
    # how many invitations are out at once, how long one stays open, and whether
    # the system sends them itself ("auto") or only when the desk does ("desk").
    invite_lead_minutes: int = 5
    invite_fanout: int = 3
    invite_open_minutes: int = 20
    early_call_invites: str = "desk"


DEFAULT_POLICY = Policy()

# The three knobs, their limits, and where each is kept. Three levels set them,
# the most specific winning: the tenant's defaults (the administrator), a unit's
# own (its manager, or the administrator) and one session's (the desk, for the
# day). A value of 0 for holdMinutes means the doctor is never held; 0 for
# maxBypass means a due patient is never passed over before the hold starts.
# The invitation knobs follow: lead 0 to 30 minutes, fan-out 0 to 10 (0 sends none),
# an invitation open 5 to 120 minutes.
POLICY_LIMITS = {
    "holdMinutes": (0, 30),
    "lateGraceMinutes": (0, 60),
    "maxBypass": (0, 3),
    "inviteLeadMinutes": (0, 30),
    "inviteFanout": (0, 10),
    "inviteOpenMinutes": (5, 120),
}
TENANT_POLICY_FIELDS = {
    "holdMinutes": "queueHoldMinutes",
    "lateGraceMinutes": "queueLateGraceMinutes",
    "maxBypass": "queueMaxBypass",
    "inviteLeadMinutes": "queueInviteLeadMinutes",
    "inviteFanout": "queueInviteFanout",
    "inviteOpenMinutes": "queueInviteOpenMinutes",
}
# A knob that is one of a few words rather than a number.
POLICY_CHOICES = {"earlyCallInvites": ("desk", "auto")}
TENANT_CHOICE_FIELDS = {"earlyCallInvites": "queueEarlyCallInvites"}
LEVELS = ("session", "unit", "tenant", "default")


def _count(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(str(value))
    except ValueError:
        return None


def policy_changes(body: dict[str, object]) -> dict[str, int | str | None]:
    """A unit's or a session's queue policy from a request. None clears an override."""
    unknown = sorted(set(body) - set(POLICY_LIMITS) - set(POLICY_CHOICES))
    if unknown:
        raise Invalid("those queue settings do not exist", detail={"unknown": unknown})
    if not body:
        raise Invalid("nothing to change")
    out: dict[str, int | str | None] = {}
    for name, value in body.items():
        if value is None:
            out[name] = None
            continue
        if name in POLICY_CHOICES:
            if value not in POLICY_CHOICES[name]:
                raise Invalid(f"{name} must be one of {', '.join(POLICY_CHOICES[name])}")
            out[name] = str(value)
            continue
        low, high = POLICY_LIMITS[name]
        number = _count(value)
        if number is None or isinstance(value, float) or not low <= number <= high:
            raise Invalid(f"{name} must be a whole number from {low} to {high}")
        out[name] = number
    return out


def resolve_policy(
    tenant: dict[str, object] | None = None,
    unit: dict[str, object] | None = None,
    session: dict[str, object] | None = None,
) -> tuple[Policy, dict[str, str]]:
    """The policy in force and, per knob, which level set it."""
    values: dict[str, int] = {
        "holdMinutes": DEFAULT_POLICY.hold_minutes,
        "lateGraceMinutes": DEFAULT_POLICY.late_grace_minutes,
        "maxBypass": DEFAULT_POLICY.max_bypass,
        "inviteLeadMinutes": DEFAULT_POLICY.invite_lead_minutes,
        "inviteFanout": DEFAULT_POLICY.invite_fanout,
        "inviteOpenMinutes": DEFAULT_POLICY.invite_open_minutes,
    }
    mode = DEFAULT_POLICY.early_call_invites
    source = dict.fromkeys((*values, *POLICY_CHOICES), "default")
    for level, layer in (("tenant", None), ("unit", unit), ("session", session)):
        for name in values:
            raw = (
                (tenant or {}).get(TENANT_POLICY_FIELDS[name])
                if level == "tenant"
                else (layer or {}).get(name)
            )
            number = _count(raw)
            if number is not None:
                values[name] = number
                source[name] = level
        raw_mode = (
            (tenant or {}).get(TENANT_CHOICE_FIELDS["earlyCallInvites"])
            if level == "tenant"
            else (layer or {}).get("earlyCallInvites")
        )
        if raw_mode in POLICY_CHOICES["earlyCallInvites"]:
            mode = str(raw_mode)
            source["earlyCallInvites"] = level
    return (
        Policy(
            values["holdMinutes"],
            values["lateGraceMinutes"],
            values["maxBypass"],
            values["inviteLeadMinutes"],
            values["inviteFanout"],
            values["inviteOpenMinutes"],
            mode,
        ),
        source,
    )


@dataclass(frozen=True, slots=True)
class Hold:
    """The doctor is held for this absent ticket until `until`."""

    appointment_id: str
    position: int
    until: dt.datetime


@dataclass(frozen=True, slots=True)
class Call:
    """What calling the next patient would do right now."""

    candidate: dict[str, object] | None  # None: nobody here, or held
    bypassed: tuple[dict[str, object], ...] = ()  # absent due tickets this call passes over
    hold: Hold | None = None  # set when the doctor is held for an absent ticket
    start_hold: tuple[str, ...] = ()  # ticket ids whose hold clock starts now
    late: tuple[str, ...] = ()  # ticket ids that have become late


def _instant(value: object) -> dt.datetime | None:
    if not value:
        return None
    return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _position(ticket: dict[str, object]) -> int:
    return int(str(ticket.get("position") or 0))


def window_end(ticket: dict[str, object]) -> dt.datetime | None:
    return _instant(ticket.get("arrivalWindowEnd"))


def is_due(ticket: dict[str, object], now: dt.datetime) -> bool:
    """The ticket's arrival window has opened."""
    opened = _instant(ticket.get("arrivalWindowStart"))
    return opened is not None and opened <= now


def is_late(ticket: dict[str, object], now: dt.datetime, policy: Policy = DEFAULT_POLICY) -> bool:
    """Lateness forfeits priority (R3): marked late, past the grace, or hold spent."""
    if ticket.get("lateAt"):
        return True
    end = window_end(ticket)
    reference = _instant(ticket.get("arrivedAt")) or now
    if end is not None and reference > end + dt.timedelta(minutes=policy.late_grace_minutes):
        return True
    held_since = _instant(ticket.get("holdStartedAt"))
    return held_since is not None and now >= held_since + dt.timedelta(minutes=policy.hold_minutes)


def next_call(
    tickets: list[dict[str, object]], now: dt.datetime, policy: Policy = DEFAULT_POLICY
) -> Call:
    """Decide who a free doctor takes, from the session's tickets in any order."""
    here = [t for t in tickets if t.get("state") == "ARRIVED"]
    if not here:
        return Call(candidate=None)

    def order(t: dict[str, object]) -> tuple[int, int, str]:
        if t.get("urgent"):
            return (0, _position(t), "")
        if is_late(t, now, policy):
            return (2, 0, str(t.get("arrivedAt") or ""))
        return (1, _position(t), "")

    candidate = sorted(here, key=order)[0]
    if candidate.get("urgent"):
        return Call(candidate=candidate)

    # Absent and due tickets the candidate would pass over. A late candidate
    # passes over nobody: they rejoined behind everyone, by their own lateness.
    passed: list[dict[str, object]] = []
    blocking: list[dict[str, object]] = []
    start_hold: list[str] = []
    late: list[str] = []
    if not is_late(candidate, now, policy):
        for t in tickets:
            if t.get("state") not in WAITING or _position(t) >= _position(candidate):
                continue
            if not is_due(t, now):
                continue
            if is_late(t, now, policy):
                if not t.get("lateAt"):
                    late.append(str(t["appointmentId"]))
                continue
            if int(str(t.get("bypassCount") or 0)) < policy.max_bypass:
                passed.append(t)
                continue
            # Already passed over as often as allowed: hold the doctor for them, then they
            # are late. With no hold at all they are late at once.
            if policy.hold_minutes == 0:
                if not t.get("lateAt"):
                    late.append(str(t["appointmentId"]))
                continue
            blocking.append(t)
            if not t.get("holdStartedAt"):
                start_hold.append(str(t["appointmentId"]))
    if blocking:
        first = min(blocking, key=_position)
        started = _instant(first.get("holdStartedAt")) or now
        until = started + dt.timedelta(minutes=policy.hold_minutes)
        return Call(
            candidate=None,
            hold=Hold(str(first["appointmentId"]), _position(first), until),
            start_hold=tuple(start_hold),
            late=tuple(late),
        )
    return Call(candidate=candidate, bypassed=tuple(passed), late=tuple(late))


# ------------------------------------------------ early-call invitations (R4)
#
# When a doctor is about to be free and nobody is here, a booked patient who is
# not yet here is invited to come earlier. Invitations run in parallel with the
# queue and never hold the doctor: a patient who arrives is checked in as any
# arrival is, and one who says no, or nothing, loses nothing and is not moved.


def invite_status(ticket: dict[str, object], now: dt.datetime) -> str | None:
    """Where a ticket's invitation stands: None, open, accepted, declined or expired."""
    if not ticket.get("inviteSentAt"):
        return None
    answer = ticket.get("inviteAnswer")
    if answer == "YES":
        return "accepted"
    if answer == "NO":
        return "declined"
    closes = _instant(ticket.get("inviteExpiresAt"))
    if closes is not None and now >= closes:
        return "expired"
    return "open"


def invite_view(ticket: dict[str, object], now: dt.datetime) -> dict[str, object] | None:
    """An invitation as the desk and the patient see it, or None if there is none."""
    status = invite_status(ticket, now)
    if status is None:
        return None
    return {
        "status": status,
        "sentAt": ticket.get("inviteSentAt"),
        "expiresAt": ticket.get("inviteExpiresAt"),
        "answer": ticket.get("inviteAnswer"),
        "eta": ticket.get("inviteEta"),
    }


def _pending_invite(ticket: dict[str, object], now: dt.datetime) -> bool:
    """An invitation still counts against the fan-out: open, or accepted and not yet due in."""
    status = invite_status(ticket, now)
    if status == "open":
        return True
    eta = _instant(ticket.get("inviteEta"))
    return status == "accepted" and ticket.get("state") in WAITING and eta is not None and eta > now


def doctor_free_within(
    tickets: list[dict[str, object]],
    now: dt.datetime,
    *,
    rostered: int,
    per_hour: float,
    lead_minutes: int,
) -> bool:
    """Whether some doctor is free now or is expected to be within `lead_minutes`."""
    busy = [t for t in tickets if t.get("state") == "IN_CONSULTATION"]
    if len(busy) < max(1, rostered):
        return True
    length = dt.timedelta(minutes=expected_consult_minutes(tickets, per_hour=per_hour))
    ends = [(_instant(t.get("consultationStartedAt")) or now) + length for t in busy]
    return min(ends) - now <= dt.timedelta(minutes=lead_minutes)


def invite_targets(
    tickets: list[dict[str, object]],
    now: dt.datetime,
    policy: Policy,
    *,
    rostered: int,
    per_hour: float,
) -> tuple[dict[str, object], ...]:
    """Who may be invited now: absent tickets by position, never invited before.

    Nobody is invited while someone is here (the doctor takes them at once, R1),
    nor before a doctor is within the lead time of being free, and no more than
    the fan-out are out at once. Each ticket is invited at most once.
    """
    if policy.invite_fanout <= 0 or any(t.get("state") == "ARRIVED" for t in tickets):
        return ()
    if not doctor_free_within(
        tickets, now, rostered=rostered, per_hour=per_hour, lead_minutes=policy.invite_lead_minutes
    ):
        return ()
    room = policy.invite_fanout - sum(1 for t in tickets if _pending_invite(t, now))
    if room <= 0:
        return ()
    absent = [t for t in tickets if t.get("state") in WAITING and invite_status(t, now) is None]
    return tuple(sorted(absent, key=_position)[:room])


def expected_consult_minutes(tickets: list[dict[str, object]], *, per_hour: float) -> float:
    """How long one consultation takes here: the median of the session's, or the pace."""
    spans = []
    for t in tickets:
        began, ended = _instant(t.get("consultationStartedAt")), _instant(t.get("completedAt"))
        if began and ended and ended > began:
            spans.append((ended - began).total_seconds() / 60)
    if not spans:
        return round(60 / max(0.1, per_hour), 1)
    spans.sort()
    middle = len(spans) // 2
    return round(spans[middle] if len(spans) % 2 else (spans[middle - 1] + spans[middle]) / 2, 1)


def outlook(
    tickets: list[dict[str, object]],
    mine: dict[str, object],
    now: dt.datetime,
    *,
    per_hour: float,
    clinicians: int = 1,
) -> dict[str, object]:
    """What one patient may be told about their place: counts and times, never people.

    Ahead is everyone waiting or here with an earlier place, so a patient called
    out of order by the rules (bypass, urgent) can wait a little more or less than
    this says; the time is an estimate and is given rounded up to five minutes.
    """
    here = str(mine.get("appointmentId", ""))
    ahead = [
        t
        for t in tickets
        if str(t.get("appointmentId", "")) != here
        and t.get("state") in (*WAITING, "ARRIVED")
        and _position(t) < _position(mine)
    ]
    lanes = max(1, clinicians)
    busy = sum(1 for t in tickets if t.get("state") == "IN_CONSULTATION")
    minutes = expected_consult_minutes(tickets, per_hour=per_hour)
    wait = len(ahead) / lanes * minutes
    if busy >= lanes:
        wait += minutes / 2
    start = now + dt.timedelta(minutes=wait)
    opens = _instant(mine.get("arrivalWindowStart"))
    if opens and start < opens:
        start = opens
    rounded = start.replace(second=0, microsecond=0)
    if start > rounded:
        rounded += dt.timedelta(minutes=1)
    rounded += dt.timedelta(minutes=(-rounded.minute) % 5)
    return {
        "ahead": len(ahead),
        "inConsultation": busy,
        "consultationMinutes": minutes,
        "expectedStartAt": rounded.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "next": not ahead and mine.get("state") == "ARRIVED",
    }
