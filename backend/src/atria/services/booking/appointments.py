"""Booking an appointment on the specialist line.

    POST /appointments      book a clinician and a time

The interesting part is not this module, it is the transaction in
atria.data.booking: the time is held by locking every grid unit the appointment
covers, so two patients asking for one minute produce one booking and one 409.

What this module owns is the order of the checks, and one rule the matrix
cannot express on its own. Where the caller is booking for their own patient
profile, every staff scope is dropped and only the patient row applies (guard
SELF_SUBJECT_DROPS_STAFF_SCOPE), so staff tooling cannot be turned on one's own
record.
"""

from __future__ import annotations

from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.core import lifecycle, permissions
from atria.core.errors import AtriaError, Conflict, Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.booking import FUTURE_YEARS, HISTORY_YEARS, Booking
from atria.data.idempotency import COMPLETED, Idempotency, validate_key
from atria.data.repository import Repository
from atria.http import requests, responses
from atria.http.handler import api
from atria.http.views import appointment_view

logger = Logger(service="atria-booking")

WHEN = ("upcoming", "past", "all")

IDEMPOTENCY_HEADER = "Idempotency-Key"

_booking: Booking | None = None
_idempotency: Idempotency | None = None


def booking() -> Booking:
    global _booking
    if _booking is None:
        _booking = Booking(Repository())
    return _booking


def idempotency() -> Idempotency:
    global _idempotency
    if _idempotency is None:
        _idempotency = Idempotency(Repository())
    return _idempotency


def actor(principal: Principal, body: dict[str, Any]) -> tuple[Principal, bool]:
    """The caller as the matrix should see them, and whether they act as a patient.

    A staff member booking for their own patient profile is the self subject
    case, and is demoted before any permission is read.
    """
    if not principal.is_staff:
        return principal, True
    target = body.get("patientProfileId")
    if (
        principal.patient_profile_id is not None
        and isinstance(target, str)
        and target.strip() == principal.patient_profile_id
    ):
        return principal.as_patient(), True
    return principal, False


def role_used(principal: Principal, permission: str) -> str | None:
    """The role the permission was granted through, for the record of who booked.

    Blank where the patient booked for themselves, which is what the data model
    means by self service.
    """
    if not principal.is_staff:
        return None
    granting = [
        role
        for role in principal.roles
        if permissions.scope_for(role, permission) != "none"
    ]
    if not granting:
        return None
    return max(granting, key=lambda r: permissions.SCOPE_RANK[permissions.scope_for(r, permission)])


def subject_of(appointment: dict[str, Any]) -> Subject:
    """The record an action is aimed at, as the matrix needs to see it."""
    return Subject(
        tenant_id=str(appointment.get("tenantId", "")),
        patient_profile_id=appointment.get("patientProfileId"),
        clinician_profile_id=appointment.get("clinicianProfileId"),
        clinic_id=appointment.get("clinicId"),
    )


def mine(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """A patient's own appointments, upcoming or past, earliest first (FR-VIS-01).

    The four range views are a later concern; what this answers is the
    question a patient actually starts with, which is what is coming up and
    what has already happened.
    """
    if principal.patient_profile_id is None:
        raise Invalid("this account holds no patient profile")
    permissions.require(
        principal,
        "appointment.read",
        Subject(
            tenant_id=principal.tenant_id,
            patient_profile_id=principal.patient_profile_id,
        ),
    )

    when = (requests.query_parameter(event, "when") or "all").lower()
    if when not in WHEN:
        raise Invalid("unknown value for when", detail={"allowed": list(WHEN)})

    data = booking()
    now = rules.instant(data.now())
    horizon = data.now().replace(year=data.now().year - HISTORY_YEARS)
    future = data.now().replace(year=data.now().year + FUTURE_YEARS)
    since, until = {
        "upcoming": (now, rules.instant(future)),
        "past": (rules.instant(horizon), now),
        "all": (rules.instant(horizon), rules.instant(future)),
    }[when]

    found = data.appointments_for_patient(
        principal.tenant_id, principal.patient_profile_id, since=since, until=until
    )
    return {
        "when": when,
        "from": since,
        "to": until,
        "count": len(found),
        "appointments": [appointment_view(a) for a in found],
    }


def one(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """One appointment, if it is inside the caller's scope (FR-VIS-02)."""
    appointment_id = requests.path_parameter(event, "id")
    appointment = booking().appointment(principal.tenant_id, appointment_id)
    subject = subject_of(appointment)
    # A staff member reading their own appointment is a patient here, the same
    # as when booking it (guard SELF_SUBJECT_DROPS_STAFF_SCOPE).
    permissions.require(
        permissions.effective_principal(principal, subject), "appointment.read", subject
    )
    return appointment_view(appointment)


def cancel(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """Cancel a booked appointment and free its time (FR-VIS-03).

    A patient cancels their own; staff cancel within their clinic and have to
    say whether the patient or the clinic called it off, because the two land
    in different states and owe the patient different things. A patient can
    only ever cancel as the patient.
    """
    appointment_id = requests.path_parameter(event, "id")
    data = booking()
    appointment = data.appointment(principal.tenant_id, appointment_id)
    subject = subject_of(appointment)
    caller = permissions.effective_principal(principal, subject)
    permissions.require(caller, "appointment.cancel", subject)

    body = requests.json_body(event) if event.get("body") else {}
    if caller.is_staff:
        cancelled_by = str(body.get("cancelledBy") or "").upper()
        if not cancelled_by:
            raise Invalid(
                "cancelledBy is required, because the entitlement depends on it",
                detail={"allowed": list(rules.CANCELLED_BY)},
            )
    else:
        # A patient cannot declare that the clinic cancelled.
        cancelled_by = "PATIENT"

    appointment_type = data.appointment_type(
        principal.tenant_id, str(appointment["appointmentTypeId"])
    )
    decided = rules.cancellation(
        cancelled_by=cancelled_by,
        start_at=rules.parse_instant(appointment["startAt"], name="startAt"),
        now=data.now(),
        cancellation_window_minutes=int(appointment_type.get("cancellationWindowMinutes") or 0),
    )

    cancelled, _event = data.cancel(
        tenant_id=principal.tenant_id,
        appointment=appointment,
        cancellation=decided,
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, "appointment.cancel"),
        reason=str(body.get("reason") or "") or None,
        minutes=rules.grid_unit_minutes(data.tenant(principal.tenant_id)),
    )
    logger.info(
        "appointment cancelled",
        extra={
            "appointmentId": appointment_id,
            "state": decided.state,
            "entitlement": decided.entitlement,
        },
    )
    return {
        **appointment_view(cancelled),
        "outcome": decided.outcome,
        "entitlement": decided.entitlement,
        "note": "The time is free again. Nothing is settled; the entitlement is a record.",
    }


def create(principal: Principal, body: dict[str, Any]) -> dict[str, Any]:
    """Book a specialist appointment, holding its grid units in one transaction."""
    caller, by_patient = actor(principal, body)

    # Asked before anything is read, so a role that cannot book at all learns
    # nothing about which clinicians or patients exist.
    permissions.require(caller, "appointment.create")

    request = rules.validate(
        body, by_patient=by_patient, own_patient_profile_id=caller.patient_profile_id
    )

    data = booking()
    membership = data.bookable_clinician(caller.tenant_id, request.clinician_profile_id)
    clinic_id = str(membership["clinicId"])

    permissions.require(
        caller,
        "appointment.create",
        Subject(
            tenant_id=caller.tenant_id,
            patient_profile_id=request.patient_profile_id,
            clinician_profile_id=request.clinician_profile_id,
            clinic_id=clinic_id,
        ),
    )

    # The patient has to exist before their time is held, or a mistyped
    # identifier would lock a clinician's morning for nobody.
    data.patient_profile(caller.tenant_id, request.patient_profile_id)

    appointment_type = data.appointment_type(caller.tenant_id, request.appointment_type_id)
    minutes = rules.grid_unit_minutes(data.tenant(caller.tenant_id))
    rules.require_on_grid(request.start_at, minutes=minutes)
    rules.require_bookable(
        appointment_type,
        by_patient=by_patient,
        now=data.now(),
        start_at=request.start_at,
    )

    occupancy = rules.occupancy(
        request.start_at,
        duration_units=int(appointment_type.get("durationUnits") or 0),
        buffer_units=int(appointment_type.get("bufferUnits") or 0),
        minutes=minutes,
    )
    lifecycle.require("appointment", None, "BOOKED")

    appointment, _event = data.book_specialist(
        tenant_id=caller.tenant_id,
        clinic_id=clinic_id,
        request=request,
        occupancy=occupancy,
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, "appointment.create"),
        local_day=occupancy.start_at.astimezone(data.zone(caller.tenant_id)).date().isoformat(),
    )
    logger.info(
        "appointment booked",
        extra={
            "appointmentId": appointment["appointmentId"],
            "clinicId": clinic_id,
            "units": len(occupancy.units),
        },
    )
    return appointment_view(appointment)


def book(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """POST /appointments, absorbing a retry that carries the same key.

    Without a key this is simply a booking. With one, the key is claimed before
    the work starts, so two requests arriving together cannot both proceed, and
    a repeat is answered with the original appointment rather than the 409 the
    slot locks would otherwise produce (FR-BKG-04).
    """
    body = requests.json_body(event)
    supplied = requests.header(event, IDEMPOTENCY_HEADER)
    if supplied is None:
        return responses.created(create(principal, body))

    key = validate_key(supplied)
    store = idempotency()
    held = store.claim(principal.tenant_id, key, request=body)
    if held is not None:
        if str(held.get("status")) != COMPLETED:
            # The first attempt is still running. Retrying again later is the
            # right answer; returning a half finished booking is not.
            raise Conflict(
                "a request with that Idempotency-Key is still being processed",
                detail={"idempotencyKey": key},
            )
        logger.info("idempotent replay", extra={"idempotencyKey": key})
        return responses.created(
            held.get("response"), headers={"Idempotency-Replayed": "true"}
        )

    try:
        booked = create(principal, body)
    except Exception:
        # The key goes back, or the client's retry would be refused for a day
        # because of a failure that had nothing to do with the key.
        store.release(principal.tenant_id, key)
        raise
    store.record(principal.tenant_id, key, response=booked)
    return responses.created(booked)


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """POST /appointments, GET /patients/me/appointments, GET /appointments/{id}"""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))

    if method == "POST" and resource.endswith("/appointments"):
        return book(principal, event)
    if method == "GET" and resource.endswith("/patients/me/appointments"):
        return responses.ok(mine(principal, event))
    if method == "GET" and resource.endswith("/appointments/{id}"):
        return responses.ok(one(principal, event))
    if method == "DELETE" and resource.endswith("/appointments/{id}"):
        return responses.ok(cancel(principal, event))

    # Every route on this function is listed above, so this is a wiring mistake
    # in the API stack rather than anything the caller did.
    raise AtriaError(f"no handler for {method} {resource}")
