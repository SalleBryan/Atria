"""The clinician directory and the free starts for one of them.

    GET /clinicians?specialty=&clinicId=&name=      who can be booked
    GET /clinicians/{id}/slots?date=&typeId=        when they are free, one date
    GET /clinicians/{id}/slots?from=&to=&typeId=    the same for up to a week, in one call
    GET /clinicians/{id}/calendar and /clinics/{id}/day, in atria.services.directory.schedule
    GET /clinics                                    where the tenant's clinics are
    GET /appointment-types                          what can be booked, and for how long

All are readable by any signed-in account of the tenant. The directory is
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

import datetime as dt
from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.core import permissions, schedule
from atria.core.errors import AtriaError, Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.booking import Booking
from atria.data.catalogue import Catalogue, as_listed
from atria.data.intake import IntakeForms, form_view
from atria.data.people import People
from atria.data.repository import Repository
from atria.http import paging, requests, responses
from atria.http.handler import api
from atria.services.directory import availability as availability_views
from atria.services.directory import capacity as capacity_views
from atria.services.directory import messages as message_views
from atria.services.directory import report as report_views
from atria.services.directory import roster as roster_views
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

# A clinic as a patient chooses between them and finds their way there.
CLINIC_FIELDS = (
    "clinicId",
    "name",
    "address",
    "phone",
    "description",
    "services",
    "openingHours",
    "location",
)

# An appointment type as a client needs it to ask for free starts and to say
# what is being booked: its length and buffer are in the tenant's grid units.
TYPE_FIELDS = (
    "appointmentTypeId",
    "code",
    "name",
    "serviceLine",
    "durationUnits",
    "bufferUnits",
    "bookableBy",
    "minNoticeMinutes",
    "maxAdvanceDays",
    "cancellationWindowMinutes",
    "patientRequestable",
    "clinicIds",
    "intakeFormId",
)

_people: People | None = None
_booking: Booking | None = None
_catalogue: Catalogue | None = None


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


def catalogue() -> Catalogue:
    global _catalogue
    if _catalogue is None:
        _catalogue = Catalogue(Repository())
    return _catalogue


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
    shown, more = paging.page(found, event)
    return {"clinicians": [listed(c) for c in shown], **more}


def list_clinics(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The tenant's clinics, by name, so a listing can say where (FR-DIR-01)."""
    permissions.require(principal, "patient.read")
    found = catalogue().clinics(principal.tenant_id)
    shown, more = paging.page(found, event)
    return {"clinics": [as_listed(c, CLINIC_FIELDS) for c in shown], **more}


def list_appointment_types(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """What the caller can book, with the grid its lengths are counted in.

    A patient is shown only what a patient may book: a procedure is sized and
    placed by staff (ADR 0005), so offering it would only lead to a refusal.
    """
    permissions.require(principal, "patient.read")
    found = catalogue().appointment_types(principal.tenant_id)
    if not principal.is_staff:
        # Staff-only types stay hidden, except a procedure a patient may request (FR-BKG-14).
        found = [
            t
            for t in found
            if str(t.get("bookableBy", "BOTH")).upper() != "STAFF" or t.get("patientRequestable")
        ]
    minutes = rules.grid_unit_minutes(booking().tenant(principal.tenant_id))
    shown, more = paging.page(found, event)
    # Each type carries the questions it asks at booking, as they stand now
    # (FR-BKG-15), so a booking screen needs no second call. The questions are
    # not care context; only the answers are.
    forms = IntakeForms(booking().repository)
    asked: dict[str, dict[str, Any] | None] = {}
    listed = []
    for t in shown:
        view = as_listed(t, TYPE_FIELDS)
        form_id = t.get("intakeFormId")
        if form_id:
            if form_id not in asked:
                current = forms.current(principal.tenant_id, str(form_id))
                asked[form_id] = form_view(current) if current else None
            view["intakeForm"] = asked[form_id]
        else:
            view["intakeForm"] = None
        listed.append(view)
    return {"gridUnitMinutes": minutes, "appointmentTypes": listed, **more}


# The widest range one call answers: the week a booking screen shows. One call
# for the week, rather than one a day, is what keeps a screen from waking seven
# cold functions at once (NFR-PERF-01).
MAX_SLOT_DAYS = 7


def list_slots(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """When one clinician is free for one appointment type (FR-DIR-02).

    `date` asks for one date. `from` and `to` ask for up to a week of them at
    once, answered as `days`, each date with its free starts; what does not
    change from one day to the next (the clinician, the type, the clinic's
    hours, the exceptions) is read once for the lot.
    """
    clinician_profile_id = requests.path_parameter(event, "id")
    raw_from = requests.query_parameter(event, "from")
    ranged = bool(raw_from)
    if ranged:
        first = schedule.parse_date(raw_from, name="from")
        raw_to = requests.query_parameter(event, "to")
        last = schedule.parse_date(raw_to, name="to") if raw_to else first
        if last < first:
            raise Invalid("to is before from")
        if (last - first).days + 1 > MAX_SLOT_DAYS:
            raise Invalid("that range is wider than a week", detail={"maximumDays": MAX_SLOT_DAYS})
    else:
        first = last = schedule.parse_date(requests.query_parameter(event, "date"))
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
    rules.require_offered(appointment_type, clinic_id)
    minutes = rules.grid_unit_minutes(data.tenant(principal.tenant_id))
    zone = data.zone(principal.tenant_id)
    clinic = data.clinic(principal.tenant_id, clinic_id)
    exceptions = data.exceptions(principal.tenant_id, clinician_profile_id)
    hours = availability_views.availability(data).hours(principal.tenant_id, clinician_profile_id)
    duration_units = int(appointment_type.get("durationUnits") or 0)
    buffer_units = int(appointment_type.get("bufferUnits") or 0)
    held = duration_units + max(0, buffer_units)
    now = data.now()

    def free_on(day: dt.date) -> list[dict[str, str]]:
        window = schedule.working_window(hours, clinic.get("openingHours"), day, zone=zone)
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
            blocked=schedule.blocked_windows(exceptions, day, zone=zone),
            duration_units=duration_units,
            buffer_units=buffer_units,
            minutes=minutes,
            now=now,
            min_notice_minutes=int(appointment_type.get("minNoticeMinutes") or 0),
            max_advance_days=int(appointment_type.get("maxAdvanceDays") or 0),
        )
        return [
            {"startAt": rules.instant(o.start_at), "endAt": rules.instant(o.end_at)} for o in free
        ]

    dates = [first + dt.timedelta(days=n) for n in range((last - first).days + 1)]
    days = {day.isoformat(): free_on(day) for day in dates}
    logger.info(
        "slots listed",
        extra={
            "clinicianProfileId": clinician_profile_id,
            "from": first.isoformat(),
            "to": last.isoformat(),
            "free": sum(len(found) for found in days.values()),
        },
    )
    shared = {
        "clinicianProfileId": clinician_profile_id,
        "clinicId": clinic_id,
        "appointmentTypeId": type_id,
        "gridUnitMinutes": minutes,
        "durationUnits": duration_units,
    }
    if ranged:
        return {**shared, "from": first.isoformat(), "to": last.isoformat(), "days": days}
    return {**shared, "date": first.isoformat(), "slots": days[first.isoformat()]}


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
    if method == "GET" and resource.endswith("/clinics/{id}/report"):
        return responses.ok(report_views.one_unit(principal, event, data=booking()))
    if method == "GET" and resource.endswith("/reports"):
        return responses.ok(report_views.every_unit(principal, event, data=booking()))
    if method == "GET" and resource.endswith("/clinics/{id}/messages"):
        return responses.ok(message_views.unit_log(principal, event, data=booking()))
    if method == "GET" and resource == "/messages":
        return responses.ok(message_views.every_unit_log(principal, event, data=booking()))
    if method == "GET" and resource.endswith("/messages/delivery"):
        return responses.ok(message_views.delivery(principal, event, data=booking()))
    if method == "GET" and resource == "/capacity":
        return responses.ok(capacity_views.week(principal, event, data=booking(), people=people()))
    if method == "GET" and resource.endswith("/roster"):
        return responses.ok(roster_views.roster(principal, event, data=booking(), people=people()))
    if method == "GET" and resource.endswith("/day"):
        return responses.ok(
            schedule_views.clinic_day(principal, event, data=booking(), people=people())
        )
    if method == "GET" and resource.endswith("/clinicians"):
        return responses.ok(list_clinicians(principal, event))
    if method == "GET" and resource == "/clinics":
        return responses.ok(list_clinics(principal, event))
    if method == "GET" and resource == "/appointment-types":
        return responses.ok(list_appointment_types(principal, event))

    # Every route on this function is listed above, so this is a wiring mistake
    # in the API stack rather than anything the caller did.
    raise AtriaError(f"no handler for {method} {resource}")
