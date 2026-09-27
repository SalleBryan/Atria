"""What happens to an appointment after it is booked.

    POST /appointments/{id}/reschedule   move it to another time (FR-VIS-07)
    POST /appointments/{id}/confirm      the patient confirms they will come
    POST /appointments/{id}/arrive       the desk records arrival (FR-STF-04)
    POST /appointments/{id}/start        the clinician starts the consultation
    POST /appointments/{id}/complete     the clinician closes it
    POST /appointments/{id}/no-show      staff record that nobody came (FR-STF-05)

Which moves exist comes from the lifecycle spec (atria_spec.lifecycle), and
who may make them from the permission matrix. What this module adds is the
when: a no-show only after the grace, a reschedule only into free time that
the type allows, and a reason from staff whenever they act on the patient's
behalf (FR-VIS-05).

Starting and closing a consultation are the clinician's own acts. The matrix
has no permission of their own for them, so they need appointment.check_in in
scope and the caller to be a clinician or a unit manager: the front desk
records arrival, it does not open a consultation.
"""

from __future__ import annotations

from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.core import permissions
from atria.core.errors import Forbidden, Invalid
from atria.core.principal import Principal
from atria.http import requests
from atria.http.views import appointment_view
from atria.services.booking.appointments import (
    booking,
    flag_self_benefit,
    role_used,
    subject_of,
)

logger = Logger(service="atria-booking")

CONSULTING_ROLES = ("CLINICIAN", "CLINIC_MANAGER")


def _load(
    principal: Principal, event: dict[str, Any], permission: str
) -> tuple[Principal, dict[str, Any]]:
    """The appointment in the path, and the caller as the matrix sees them for it."""
    appointment_id = requests.path_parameter(event, "id")
    appointment = booking().appointment(principal.tenant_id, appointment_id)
    subject = subject_of(appointment)
    caller = permissions.effective_principal(principal, subject)
    permissions.require(caller, permission, subject)
    return caller, appointment


def _body(event: dict[str, Any]) -> dict[str, Any]:
    return requests.json_body(event) if event.get("body") else {}


def _moved(
    caller: Principal,
    appointment: dict[str, Any],
    *,
    to_state: str,
    kind: str,
    permission: str,
    stamp: str,
    reason: str | None = None,
) -> dict[str, Any]:
    data = booking()
    moved, _event = data.move(
        tenant_id=caller.tenant_id,
        appointment=appointment,
        to_state=to_state,
        kind=kind,
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, permission),
        reason=reason,
        fields={stamp: rules.instant(data.now())},
    )
    logger.info(
        "appointment moved",
        extra={"appointmentId": appointment["appointmentId"], "state": to_state},
    )
    return appointment_view(moved)


def reschedule(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """Move a visit to a free time, keeping its reference (FR-VIS-07)."""
    caller, appointment = _load(principal, event, "appointment.reschedule")
    body = _body(event)
    by_staff = caller.is_staff

    rescheduled_by = "PATIENT"
    if by_staff:
        # As with a cancellation, staff say whose move it is, because a clinic
        # move is recorded against the clinic (FR-MSR-06).
        rescheduled_by = str(body.pop("rescheduledBy", "") or "").upper()
        if rescheduled_by not in rules.RESCHEDULED_BY:
            raise Invalid(
                "rescheduledBy is required, because what the patient is owed depends on it",
                detail={"allowed": list(rules.RESCHEDULED_BY)},
            )
    request = rules.reschedule_request(body)
    reason = rules.require_reason(request.reason, by_staff=by_staff, action="move")

    data = booking()
    tenant_id = caller.tenant_id
    clinician_id = request.clinician_profile_id or str(appointment["clinicianProfileId"])
    if not by_staff and clinician_id != appointment["clinicianProfileId"]:
        raise Invalid("a patient moves the time; to see someone else, book a new visit")

    membership = data.bookable_clinician(tenant_id, clinician_id)
    clinic_id = str(membership["clinicId"])
    moved_subject = permissions.Subject(
        tenant_id=tenant_id,
        patient_profile_id=appointment.get("patientProfileId"),
        clinician_profile_id=clinician_id,
        clinic_id=clinic_id,
    )
    # The new place has to be inside the caller's scope as much as the old one.
    permissions.require(caller, "appointment.reschedule", moved_subject)

    now = data.now()
    if request.start_at <= now:
        raise Invalid("a visit can only be moved to a time still to come")
    appointment_type = data.appointment_type(tenant_id, str(appointment["appointmentTypeId"]))
    minutes = rules.grid_unit_minutes(data.tenant(tenant_id))
    rules.require_on_grid(request.start_at, minutes=minutes)
    rules.require_bookable(
        appointment_type, by_patient=not by_staff, now=now, start_at=request.start_at
    )
    occupancy = rules.occupancy(
        request.start_at,
        duration_units=int(appointment_type.get("durationUnits") or 0),
        buffer_units=int(appointment_type.get("bufferUnits") or 0),
        minutes=minutes,
    )

    flag_self_benefit(caller, appointment, data)
    moved, _event = data.reschedule(
        tenant_id=tenant_id,
        appointment=appointment,
        clinician_profile_id=clinician_id,
        clinic_id=clinic_id,
        occupancy=occupancy,
        rescheduled_by=rescheduled_by,
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, "appointment.reschedule"),
        reason=reason,
        minutes=minutes,
        local_day=occupancy.start_at.astimezone(data.zone(tenant_id)).date().isoformat(),
    )
    logger.info(
        "appointment rescheduled",
        extra={"appointmentId": appointment["appointmentId"], "by": rescheduled_by},
    )
    return appointment_view(moved)


def confirm(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The patient says they will come. Only the patient can (lifecycle: patient confirms)."""
    caller, appointment = _load(principal, event, "appointment.read")
    if caller.is_staff:
        raise Forbidden("only the patient can confirm their own visit")
    return _moved(
        caller,
        appointment,
        to_state="CONFIRMED",
        kind="CONFIRMED",
        permission="appointment.read",
        stamp="confirmedAt",
    )


def arrive(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The desk records that the patient is here (FR-STF-04)."""
    caller, appointment = _load(principal, event, "appointment.check_in")
    return _moved(
        caller,
        appointment,
        to_state="ARRIVED",
        kind="ARRIVED",
        permission="appointment.check_in",
        stamp="arrivedAt",
    )


def _consulting(caller: Principal) -> None:
    if not any(caller.has_role(role) for role in CONSULTING_ROLES):
        raise Forbidden("a consultation is opened and closed by a clinician")


def start(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The clinician calls the patient in."""
    caller, appointment = _load(principal, event, "appointment.check_in")
    _consulting(caller)
    return _moved(
        caller,
        appointment,
        to_state="IN_CONSULTATION",
        kind="CONSULTATION_STARTED",
        permission="appointment.check_in",
        stamp="consultationStartedAt",
    )


def complete(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The clinician closes the consultation."""
    caller, appointment = _load(principal, event, "appointment.check_in")
    _consulting(caller)
    return _moved(
        caller,
        appointment,
        to_state="COMPLETED",
        kind="COMPLETED",
        permission="appointment.check_in",
        stamp="completedAt",
    )


def no_show(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """Staff confirm that nobody came, once the grace after the end has passed (FR-STF-05)."""
    caller, appointment = _load(principal, event, "appointment.mark_no_show")
    rules.require_no_show_due(appointment, now=booking().now())
    return _moved(
        caller,
        appointment,
        to_state="NO_SHOW",
        kind="NO_SHOW",
        permission="appointment.mark_no_show",
        stamp="noShowAt",
    )


ACTIONS = {
    "reschedule": reschedule,
    "confirm": confirm,
    "arrive": arrive,
    "start": start,
    "complete": complete,
    "no-show": no_show,
}
