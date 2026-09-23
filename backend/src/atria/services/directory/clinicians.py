"""The clinician directory and the free starts for one of them.

    GET /clinicians?specialty=&clinicId=&name=      who can be booked
    GET /clinicians/{id}/slots?date=&typeId=        when they are free
    GET /clinicians/{id}/calendar and /clinics/{id}/day, in atria.services.directory.schedule

Both are readable by any signed-in account of the tenant. The directory is
ordered by seniority band and carries no score of any kind: a patient chooses
on specialty, qualifications and languages, never on a rating (ADR 0011).

A free start is one where every grid unit the appointment occupies, the
type's buffer included, is inside the clinic's working hours, unlocked,
unblocked and far enough ahead to meet the type's minimum notice. The locks are
the same items a booking writes, so a start offered here and taken by somebody
else in between is refused at booking with a 409 rather than being quietly
double booked.
"""

from __future__ import annotations

from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.core import permissions, schedule
from atria.core.errors import AtriaError, Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.booking import Booking
from atria.data.people import People
from atria.data.repository import Repository
from atria.http import requests, responses
from atria.http.handler import api
from atria.services.directory import schedule as schedule_views

logger = Logger(service="atria-directory")

# What a listing may carry. Everything else on the profile stays internal, and
# no field here could be read as a quality score.
LISTED_FIELDS = (
    "clinicianProfileId",
    "clinicId",
    "givenName",
    "familyName",
    "specialty",
    "qualifications",
    "registrationYear",
    "seniorityBand",
    "languages",
)

_people: People | None = None
_booking: Booking | None = None


def people() -> People:
    global _people
    if _people is None:
        _people = People(Repository())
    return _people


def booking() -> Booking:
    global _booking
    if _booking is None:
        _booking = Booking(Repository())
    return _booking


def listed(clinician: dict[str, Any]) -> dict[str, Any]:
    return {name: clinician.get(name) for name in LISTED_FIELDS}


def list_clinicians(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """Who this tenant's patients can book (FR-DIR-01)."""
    permissions.require(principal, "patient.read")
    found = people().clinicians(
        principal.tenant_id,
        specialty=requests.query_parameter(event, "specialty"),
        clinic_id=requests.query_parameter(event, "clinicId"),
        name=requests.query_parameter(event, "name"),
    )
    return {"clinicians": [listed(c) for c in found], "count": len(found)}


def list_slots(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """When one clinician is free for one appointment type on one date (FR-DIR-02)."""
    clinician_profile_id = requests.path_parameter(event, "id")
    day = schedule.parse_date(requests.query_parameter(event, "date"))
    type_id = requests.query_parameter(event, "typeId")
    if not type_id:
        # Without the type there is no duration, and without a duration there
        # is nothing to decide whether a start is free.
        raise Invalid("typeId is required, because the duration comes from it")

    data = booking()
    membership = data.bookable_clinician(principal.tenant_id, clinician_profile_id)
    clinic_id = str(membership["clinicId"])

    # Reading a clinician's day is reading the clinic's day, so it is bounded
    # by the same scope a staff calendar is.
    permissions.require(
        principal,
        "appointment.read",
        Subject(
            tenant_id=principal.tenant_id,
            clinician_profile_id=clinician_profile_id,
            clinic_id=clinic_id,
            patient_profile_id=principal.patient_profile_id,
        ),
    )

    appointment_type = data.appointment_type(principal.tenant_id, str(type_id))
    minutes = rules.grid_unit_minutes(data.tenant(principal.tenant_id))
    zone = data.zone(principal.tenant_id)

    clinic = data.clinic(principal.tenant_id, clinic_id)
    window = schedule.opening_window(clinic.get("openingHours"), day, zone=zone)

    duration_units = int(appointment_type.get("durationUnits") or 0)
    buffer_units = int(appointment_type.get("bufferUnits") or 0)
    held = duration_units + max(0, buffer_units)

    locked: set[str] = set()
    if window is not None and held:
        every_unit = [
            rules.instant(start)
            for start in schedule.candidate_starts(window, held_units=1, minutes=minutes)
        ]
        locked = data.locked_units(principal.tenant_id, clinician_profile_id, every_unit)

    free = schedule.free_starts(
        window=window,
        locked_units=locked,
        blocked=schedule.blocked_windows(
            data.exceptions(principal.tenant_id, clinician_profile_id), day, zone=zone
        ),
        duration_units=duration_units,
        buffer_units=buffer_units,
        minutes=minutes,
        now=data.now(),
        min_notice_minutes=int(appointment_type.get("minNoticeMinutes") or 0),
        max_advance_days=int(appointment_type.get("maxAdvanceDays") or 0),
    )
    logger.info(
        "slots listed",
        extra={
            "clinicianProfileId": clinician_profile_id,
            "date": day.isoformat(),
            "free": len(free),
            "locked": len(locked),
        },
    )
    return {
        "clinicianProfileId": clinician_profile_id,
        "clinicId": clinic_id,
        "date": day.isoformat(),
        "appointmentTypeId": type_id,
        "gridUnitMinutes": minutes,
        "durationUnits": duration_units,
        "slots": [
            {"startAt": rules.instant(o.start_at), "endAt": rules.instant(o.end_at)} for o in free
        ],
    }


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """The directory, free starts, a clinician's calendar and a clinic's day."""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))

    if method == "GET" and resource.endswith("/slots"):
        return responses.ok(list_slots(principal, event))
    if method == "GET" and resource.endswith("/calendar"):
        return responses.ok(
            schedule_views.calendar(principal, event, data=booking(), people=people())
        )
    if method == "GET" and resource.endswith("/day"):
        return responses.ok(schedule_views.clinic_day(principal, event, data=booking()))
    if method == "GET" and resource.endswith("/clinicians"):
        return responses.ok(list_clinicians(principal, event))

    # Every route on this function is listed above, so this is a wiring mistake
    # in the API stack rather than anything the caller did.
    raise AtriaError(f"no handler for {method} {resource}")
