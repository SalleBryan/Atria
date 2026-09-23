"""What is booked: one clinician's calendar, and one clinic's day.

    GET /clinicians/{id}/calendar?from=&to=     one clinician, a range of dates
    GET /clinics/{id}/day?date=                 every clinician in a clinic, one date

FR-STF-01: a clinician views their own calendar, and a receptionist or clinic
manager views any clinician's day in their clinic. Both go through
appointment.read, so the permission matrix decides who reaches what: a
clinician's scope is their own appointments, which is exactly their calendar
and not the clinic's day.

Dates are the clinic's own dates. A patient booked at 00:30 in Douala is on
that local date's list, though the instant is 23:30 UTC the day before; the
range is converted to UTC once, here, from the region pack's timezone.

Every state is returned, cancelled appointments included, and each entry
carries its state. A front desk asking why a slot is empty wants to see the
cancellation, and hiding it would have the client guess.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core import booking as rules
from atria.core import permissions, schedule
from atria.core.errors import Invalid, NotFound
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.booking import Booking
from atria.data.people import People
from atria.http import requests
from atria.http.views import appointment_view

# A month, which is the widest view the calendar offers. Anything wider is a
# report, not a calendar, and would read a clinician's whole history.
MAX_DAYS = 31

# A week, which is what a calendar opens on when no range is asked for.
DEFAULT_DAYS = 7


def local_range(
    start_day: dt.date, end_day: dt.date, *, zone: Any
) -> tuple[str, str]:
    """The UTC instants covering whole local dates, both ends included."""
    opens = dt.datetime.combine(start_day, dt.time.min, tzinfo=zone).astimezone(dt.UTC)
    closes = dt.datetime.combine(
        end_day + dt.timedelta(days=1), dt.time.min, tzinfo=zone
    ).astimezone(dt.UTC) - dt.timedelta(seconds=1)
    return rules.instant(opens), rules.instant(closes)


def calendar(
    principal: Principal, event: dict[str, Any], *, data: Booking, people: People
) -> dict[str, Any]:
    """One clinician's appointments over a range of their clinic's dates."""
    clinician_id = requests.path_parameter(event, "id")
    membership = people.staff(principal.tenant_id, clinician_id)
    if "CLINICIAN" not in membership.get("roles", []):
        # Named as the record the caller asked for, so a refusal does not
        # reveal that some other kind of staff account has this identifier.
        raise NotFound("no such clinician")
    clinic_id = str(membership.get("clinicId") or "")

    permissions.require(
        principal,
        "appointment.read",
        Subject(
            tenant_id=principal.tenant_id,
            clinician_profile_id=clinician_id,
            clinic_id=clinic_id,
        ),
    )

    zone = data.zone(principal.tenant_id)
    today = data.now().astimezone(zone).date()
    raw_from = requests.query_parameter(event, "from")
    raw_to = requests.query_parameter(event, "to")
    start_day = schedule.parse_date(raw_from, name="from") if raw_from else today
    end_day = (
        schedule.parse_date(raw_to, name="to")
        if raw_to
        else start_day + dt.timedelta(days=DEFAULT_DAYS - 1)
    )
    if end_day < start_day:
        raise Invalid("to is before from")
    if (end_day - start_day).days + 1 > MAX_DAYS:
        raise Invalid(
            "that range is wider than a calendar shows", detail={"maximumDays": MAX_DAYS}
        )

    since, until = local_range(start_day, end_day, zone=zone)
    found = data.calendar(principal.tenant_id, clinician_id, since=since, until=until)
    return {
        "clinicianProfileId": clinician_id,
        "clinicId": clinic_id,
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "timezone": str(zone),
        "count": len(found),
        "appointments": [appointment_view(a) for a in found],
    }


def clinic_day(
    principal: Principal, event: dict[str, Any], *, data: Booking
) -> dict[str, Any]:
    """Every appointment in one clinic on one of its dates."""
    clinic_id = requests.path_parameter(event, "id")
    data.clinic(principal.tenant_id, clinic_id)
    permissions.require(
        principal,
        "appointment.read",
        Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id),
    )

    zone = data.zone(principal.tenant_id)
    raw = requests.query_parameter(event, "date")
    day = (
        schedule.parse_date(raw, name="date") if raw else data.now().astimezone(zone).date()
    )
    found = data.clinic_day(principal.tenant_id, clinic_id, day.isoformat())
    return {
        "clinicId": clinic_id,
        "date": day.isoformat(),
        "timezone": str(zone),
        "count": len(found),
        "appointments": [appointment_view(a) for a in found],
    }
