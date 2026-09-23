"""When a reminder fires, and whether one is owed at all.

A booking gets one reminder, sent a lead time before the appointment, 24 hours
by default (FR-REM-01). The fire time is worked out on the clinic's own clock
and then stored in UTC (FR-REM-05). Douala keeps no daylight saving, so for
Cameroon the two agree; the order matters for a region pack whose clock does
change, where "a day before" means the same wall clock time the day before and
not 24 elapsed hours.

A booking made inside the lead time gets no reminder, because the time it would
fire has already passed. The patient is sent a confirmation by SMS straight
away instead (FR-REM-06).
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from atria.core.errors import Invalid

DEFAULT_LEAD = dt.timedelta(hours=24)

# Jobs on the outbox that arrange a reminder rather than send one.
SCHEDULE = "SCHEDULE_REMINDER"
CANCEL = "CANCEL_REMINDER"

# The appointment states a reminder is still owed in. Cancelled, completed and
# no-show appointments are past reminding.
REMINDABLE = ("BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED")

# EventBridge Scheduler names: letters, digits, hyphen, underscore and full
# stop, at most 64 characters.
_NAME = re.compile(r"^[0-9A-Za-z_.-]{1,64}$")


@dataclass(frozen=True, slots=True)
class Plan:
    """What to do about a reminder for one appointment."""

    fire_at: dt.datetime
    send_now: bool
    """True when the fire time has already passed (FR-REM-06)."""


def fire_at(
    start_at: dt.datetime, *, zone: ZoneInfo, lead: dt.timedelta = DEFAULT_LEAD
) -> dt.datetime:
    """The instant the reminder is sent, as UTC.

    Subtracting on an aware datetime in the clinic's zone is wall clock
    arithmetic, which is what FR-REM-05 asks for; converting back to UTC then
    gives the instant to schedule.
    """
    if start_at.tzinfo is None:
        raise Invalid("an appointment start must carry an offset")
    return (start_at.astimezone(zone) - lead).astimezone(dt.UTC)


def plan(
    start_at: dt.datetime,
    *,
    now: dt.datetime,
    zone: ZoneInfo,
    lead: dt.timedelta = DEFAULT_LEAD,
) -> Plan:
    """Schedule a reminder, or say it is too late for one."""
    when = fire_at(start_at, zone=zone, lead=lead)
    return Plan(fire_at=when, send_now=when <= now)


def schedule_name(appointment_id: str) -> str:
    """The schedule's name, derived from the appointment.

    Derived rather than generated, so a cancellation can remove it knowing
    nothing but the appointment, and creating it twice is refused rather than
    producing a second reminder.
    """
    name = f"reminder-{appointment_id}"
    if not _NAME.match(name):
        raise Invalid("that appointment identifier cannot name a schedule")
    return name


def at_expression(when: dt.datetime) -> str:
    """The one-time schedule expression EventBridge Scheduler takes, in UTC."""
    return f"at({when.astimezone(dt.UTC).strftime('%Y-%m-%dT%H:%M:%S')})"
