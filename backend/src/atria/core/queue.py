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
