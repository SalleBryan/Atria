"""Which starts a clinician is free for.

A start is free when every grid unit the appointment occupies, the type's
buffer included, is inside working hours, not already locked, not blocked by an
exception, and far enough ahead to satisfy the type's minimum notice
(FR-DIR-02).

Working hours come from the clinic's opening hours for that weekday. Phase 1
reads fixed hours from seed configuration, so a clinic with no opening hours
recorded is treated as closed rather than given a default: inventing hours
would offer a patient a start the clinic never agreed to.

Hours are local to the clinic, in the region pack's timezone, while locks and
appointments are instants in UTC. The conversion happens here, once, so the
rest of the system keeps working in UTC (FR-REM-05 asks the reminder path to
do the same).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from atria.core import booking as rules
from atria.core.errors import Invalid

# The region pack's timezone for Cameroon. Africa/Douala is UTC+1 and observes
# no daylight saving, which is why a fixed offset would pass every test here
# and still be the wrong thing to write.
DEFAULT_TIMEZONE = "Africa/Douala"


@dataclass(frozen=True, slots=True)
class Window:
    """One span of working time on one day, as instants."""

    opens_at: dt.datetime
    closes_at: dt.datetime


def timezone_for(region_pack: dict[str, object] | None) -> ZoneInfo:
    name = str((region_pack or {}).get("timezone") or DEFAULT_TIMEZONE)
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise Invalid(f"the region pack names an unknown timezone: {name}") from exc


def parse_date(value: object, *, name: str = "date") -> dt.date:
    """A calendar date, which is what a patient asks about."""
    if not isinstance(value, str) or not value.strip():
        raise Invalid(f"{name} is required, as YYYY-MM-DD")
    try:
        return dt.date.fromisoformat(value.strip())
    except ValueError as exc:
        raise Invalid(f"{name} must be a date in the form YYYY-MM-DD") from exc


def _time(value: object, *, what: str) -> dt.time:
    if not isinstance(value, str):
        raise Invalid(f"the unit's {what} is not a time")
    try:
        return dt.time.fromisoformat(value)
    except ValueError as exc:
        raise Invalid(f"the unit's {what} is not a time in the form HH:MM") from exc


def opening_window(opening_hours: object, day: dt.date, *, zone: ZoneInfo) -> Window | None:
    """The clinic's working span on one day, or None when it is closed.

    Opening hours are keyed by weekday, Monday as 0, matching
    AVAILABILITY_TEMPLATE.weekday so the Phase 2 model can replace this without
    the callers changing.
    """
    if not isinstance(opening_hours, dict):
        return None
    entry = opening_hours.get(str(day.weekday())) or opening_hours.get(day.weekday())
    if not isinstance(entry, dict):
        return None
    opens = _time(entry.get("start"), what="opening time")
    closes = _time(entry.get("end"), what="closing time")
    if closes <= opens:
        raise Invalid("the unit closes before it opens on that day")
    return Window(
        opens_at=dt.datetime.combine(day, opens, tzinfo=zone).astimezone(dt.UTC),
        closes_at=dt.datetime.combine(day, closes, tzinfo=zone).astimezone(dt.UTC),
    )


def blocked_windows(
    exceptions: list[dict[str, object]], day: dt.date, *, zone: ZoneInfo
) -> list[Window]:
    """The spans an exception marks unavailable on that day (D-03).

    Only UNAVAILABLE is read here. An EXTRA exception adds hours, which is
    Phase 2's availability model, and adding them now would offer starts the
    Phase 1 seed configuration does not describe.
    """
    windows: list[Window] = []
    for entry in exceptions:
        if str(entry.get("kind", "")).upper() != "UNAVAILABLE":
            continue
        if str(entry.get("exceptionDate", "")) != day.isoformat():
            continue
        start = entry.get("startTime")
        end = entry.get("endTime")
        if start is None or end is None:
            # A whole day off, which is the common case for leave.
            windows.append(
                Window(
                    opens_at=dt.datetime.combine(day, dt.time.min, tzinfo=zone).astimezone(dt.UTC),
                    closes_at=dt.datetime.combine(
                        day + dt.timedelta(days=1), dt.time.min, tzinfo=zone
                    ).astimezone(dt.UTC),
                )
            )
            continue
        windows.append(
            Window(
                opens_at=dt.datetime.combine(
                    day, _time(start, what="exception start"), tzinfo=zone
                ).astimezone(dt.UTC),
                closes_at=dt.datetime.combine(
                    day, _time(end, what="exception end"), tzinfo=zone
                ).astimezone(dt.UTC),
            )
        )
    return windows


def overlaps(window: Window, start: dt.datetime, end: dt.datetime) -> bool:
    return start < window.closes_at and end > window.opens_at


def candidate_starts(window: Window, *, held_units: int, minutes: int) -> list[dt.datetime]:
    """Every grid aligned start whose whole occupancy fits inside the window."""
    step = dt.timedelta(minutes=minutes)
    span = step * held_units
    starts: list[dt.datetime] = []
    at = window.opens_at
    while at + span <= window.closes_at:
        starts.append(at)
        at += step
    return starts


def free_starts(
    *,
    window: Window | None,
    locked_units: set[str],
    blocked: list[Window],
    duration_units: int,
    buffer_units: int,
    minutes: int,
    now: dt.datetime,
    min_notice_minutes: int = 0,
    max_advance_days: int = 0,
) -> list[rules.Occupancy]:
    """The starts a patient may choose, in time order.

    Returned as occupancies rather than instants because the caller needs the
    end the patient is told about, which is the duration and not the buffer.
    """
    if window is None:
        return []
    held = duration_units + max(0, buffer_units)
    earliest = now + dt.timedelta(minutes=min_notice_minutes)
    latest = now + dt.timedelta(days=max_advance_days) if max_advance_days else None

    free: list[rules.Occupancy] = []
    for start in candidate_starts(window, held_units=held, minutes=minutes):
        if start < earliest or (latest is not None and start > latest):
            continue
        occupancy = rules.occupancy(
            start, duration_units=duration_units, buffer_units=buffer_units, minutes=minutes
        )
        if locked_units.intersection(occupancy.units):
            continue
        if any(overlaps(block, start, occupancy.held_until) for block in blocked):
            continue
        free.append(occupancy)
    return free


# ---------------------------------------------------------------- availability
# Phase 2's model (FR-DIR-03 to FR-DIR-05, FR-STF-10). A clinician's working
# hours are an AVAILABILITY_TEMPLATE per weekday; exceptions take time away.

WEEKDAYS = range(7)

# How staff take time away, all stored as UNAVAILABLE exceptions so the free
# search reads them one way. They differ in what happens to visits already in
# the window: a block refuses to cover a booking (the visit is moved or
# cancelled first, so the patient is told, FR-DIR-04); leave and marking a
# clinician unavailable disrupt the visits inside (FR-DIR-05, FR-STF-10).
EXCEPTION_KINDS = ("BLOCK", "LEAVE", "UNAVAILABLE")

# The longest leave recorded in one go; longer is two requests, not a typo.
MAX_LEAVE_DAYS = 62


def working_window(
    templates: list[dict[str, object]],
    opening_hours: object,
    day: dt.date,
    *,
    zone: ZoneInfo,
) -> Window | None:
    """A clinician's working span on one day, or None when they do not work it.

    A clinician with hours of their own works those, and a weekday without
    them is a day off. One with none recorded works the unit's opening hours,
    which is what every clinician did before hours could be set.
    """
    if not templates:
        return opening_window(opening_hours, day, zone=zone)
    for template in templates:
        if int(str(template.get("weekday", -1))) == day.weekday():
            return opening_window(
                {
                    str(day.weekday()): {
                        "start": template.get("startTime"),
                        "end": template.get("endTime"),
                    }
                },
                day,
                zone=zone,
            )
    return None


def validate_hours(body: dict[str, object], *, minutes: int) -> dict[int, tuple[str, str]]:
    """A week of working hours: weekday (Monday 0) to start and end, HH:MM.

    A weekday left out, or given as null, is a day off. Hours sit on the
    tenant's grid, or a start on the hour would be offered no unit to start in.
    """
    days = body.get("days")
    if not isinstance(days, dict):
        raise Invalid("days is required: weekday 0 (Monday) to 6, each {start, end} or null")
    hours: dict[int, tuple[str, str]] = {}
    for raw, entry in days.items():
        try:
            weekday = int(str(raw))
        except ValueError as exc:
            raise Invalid(f"{raw} is not a weekday; use 0 (Monday) to 6") from exc
        if weekday not in WEEKDAYS:
            raise Invalid(f"{raw} is not a weekday; use 0 (Monday) to 6")
        if entry is None:
            continue
        if not isinstance(entry, dict):
            raise Invalid(f"weekday {weekday} must be {{start, end}} or null")
        start = _time(entry.get("start"), what="start")
        end = _time(entry.get("end"), what="end")
        if end <= start:
            raise Invalid(f"on weekday {weekday} the hours end before they start")
        for moment in (start, end):
            if (moment.hour * 60 + moment.minute) % minutes or moment.second:
                raise Invalid(
                    "working hours must fall on the grid",
                    detail={"gridUnitMinutes": minutes, "weekday": weekday},
                )
        hours[weekday] = (start.strftime("%H:%M"), end.strftime("%H:%M"))
    return hours


def exception_days(body: dict[str, object], *, today: dt.date) -> list[dt.date]:
    """The dates an exception covers: one date, or from and to for leave."""
    if body.get("from") is not None:
        first = parse_date(body.get("from"), name="from")
        last = parse_date(body.get("to") or body.get("from"), name="to")
    else:
        first = last = parse_date(body.get("date"), name="date")
    if last < first:
        raise Invalid("to is before from")
    if first < today:
        raise Invalid("time can only be taken away from today onwards")
    if (last - first).days + 1 > MAX_LEAVE_DAYS:
        raise Invalid(
            "that is longer than one request covers", detail={"maximumDays": MAX_LEAVE_DAYS}
        )
    return [first + dt.timedelta(days=n) for n in range((last - first).days + 1)]


def exception_span(
    body: dict[str, object], *, days: list[dt.date]
) -> tuple[str | None, str | None]:
    """The part of each day taken away: startTime and endTime, or the whole day.

    Part of a day is for a single date; leave over several days is whole days.
    """
    start, end = body.get("startTime"), body.get("endTime")
    if start is None and end is None:
        return None, None
    if start is None or end is None:
        raise Invalid("give both startTime and endTime, or neither for the whole day")
    if len(days) > 1:
        raise Invalid("part of a day can only be taken away one date at a time")
    opens, closes = _time(start, what="start"), _time(end, what="end")
    if closes <= opens:
        raise Invalid("the time taken away ends before it starts")
    return opens.strftime("%H:%M"), closes.strftime("%H:%M")


def exception_windows(
    days: list[dt.date], start: str | None, end: str | None, *, zone: ZoneInfo
) -> list[Window]:
    """The instants an exception covers, one window per date."""
    return [
        window
        for day in days
        for window in blocked_windows(
            [
                {
                    "kind": "UNAVAILABLE",
                    "exceptionDate": day.isoformat(),
                    "startTime": start,
                    "endTime": end,
                }
            ],
            day,
            zone=zone,
        )
    ]
