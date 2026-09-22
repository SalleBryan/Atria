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
from atria.core.errors import AtriaError
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.booking import Booking
from atria.data.repository import Repository
from atria.http import requests, responses
from atria.http.handler import api

logger = Logger(service="atria-booking")

_booking: Booking | None = None


def booking() -> Booking:
    global _booking
    if _booking is None:
        _booking = Booking(Repository())
    return _booking


# What the API returns. Listed rather than passing the record through, because
# the record also carries storage fields that are not part of the contract.
VIEW_FIELDS = (
    "appointmentId",
    "reference",
    "tenantId",
    "clinicId",
    "patientProfileId",
    "appointmentTypeId",
    "clinicianProfileId",
    "sessionId",
    "startAt",
    "endAt",
    "state",
    "channel",
    "bookedByPersonId",
    "bookedByRole",
    "referralId",
    "careContextId",
    "version",
    "createdAt",
)


def appointment_view(appointment: dict[str, Any]) -> dict[str, Any]:
    """The appointment as the contract describes it, and nothing further."""
    return {name: appointment.get(name) for name in VIEW_FIELDS}


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


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """POST /appointments"""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))

    if method == "POST" and resource.endswith("/appointments"):
        return responses.created(create(principal, requests.json_body(event)))

    # Every route on this function is listed above, so this is a wiring mistake
    # in the API stack rather than anything the caller did.
    raise AtriaError(f"no handler for {method} {resource}")
