"""Procedure requests and the inbox that sizes and places them (FR-BKG-14, FR-STF-15).

    POST /procedure-requests             a patient asks for a procedure; no time is held
    GET  /clinics/{id}/requests          the unit's inbox of requests waiting
    POST /appointments/{id}/place        staff size it and place it: a clinician and a time
    POST /appointments/{id}/decline      staff decline it, with a reason the patient reads

A request is an appointment in REQUESTED, holding no units, filed on the
unit's request list (clinicDay <unit>#REQUESTS) so the inbox is one query.
Placing it locks the units in one transaction and moves it to BOOKED, from
where the patient's own confirmation makes it CONFIRMED (ADR 0005). The
patient follows it in their visits all along.
"""

from __future__ import annotations

from typing import Any

from atria.core import booking as rules
from atria.core import lifecycle, permissions
from atria.core import settings as setting_rules
from atria.core.errors import Conflict, Forbidden, Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.booking import LOCK_GRACE, event_item, lock_item, reference
from atria.data.people import People, new_id
from atria.http import requests
from atria.http.views import appointment_view
from atria.services.booking.appointments import booking, role_used

REQUESTS = "REQUESTS"
MAX_NOTE = 500


def request(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """A patient asks for a procedure a unit offers to be requested."""
    if principal.patient_profile_id is None:
        raise Invalid("this account holds no patient profile")
    caller = principal.as_patient() if principal.is_staff else principal
    body = requests.json_body(event)
    data = booking()
    clinic_id = str(body.get("clinicId") or "")
    data.clinic(caller.tenant_id, clinic_id)
    subject = Subject(
        tenant_id=caller.tenant_id,
        patient_profile_id=caller.patient_profile_id,
        clinic_id=clinic_id,
    )
    permissions.require(caller, "procedure.request", subject)
    kind = data.appointment_type(caller.tenant_id, str(body.get("appointmentTypeId") or ""))
    if (
        not kind.get("patientRequestable")
        or kind.get("serviceLine") != "PROCEDURE"
        or not kind.get("active", True)
    ):
        raise Invalid("that is not a procedure a patient can request")
    if not setting_rules.offered_at(kind, clinic_id):
        raise Invalid("that unit does not offer this procedure")
    note = str(body.get("note") or "").strip()
    if len(note) > MAX_NOTE:
        raise Invalid(f"the note is at most {MAX_NOTE} characters")
    lifecycle.require("appointment", None, "REQUESTED")

    now = rules.instant(data.now())
    appointment_id = new_id("a")
    item = {
        "type": "APPOINTMENT",
        "appointmentId": appointment_id,
        "reference": reference(appointment_id),
        "tenantId": caller.tenant_id,
        "clinicId": clinic_id,
        "patientProfileId": caller.patient_profile_id,
        "appointmentTypeId": kind["appointmentTypeId"],
        # No clinicianProfileId until placed: an index key is absent, never null.
        "sessionId": None,
        # No time is held. The request is filed at when it was made, so the
        # patient's list and the inbox order it, and is marked as a request.
        "startAt": now,
        "endAt": now,
        "clinicDay": f"{clinic_id}#{REQUESTS}",
        "state": "REQUESTED",
        "channel": "ONLINE",
        "bookedByPersonId": caller.person_id,
        "bookedByRole": None,
        "requestNote": note or None,
        "version": 1,
        "createdAt": now,
    }
    first = event_item(
        appointment_id=appointment_id,
        tenant_id=caller.tenant_id,
        kind="REQUESTED",
        from_state=None,
        to_state="REQUESTED",
        actor_person_id=caller.person_id,
        actor_role=None,
        reason=None,
        occurred_at=now,
    )
    data.repository.write_together(
        [
            (keys.appointment(caller.tenant_id, appointment_id), item),
            (
                keys.appointment_event(
                    caller.tenant_id, appointment_id, now, str(first["appointmentEventId"])
                ),
                first,
            ),
        ]
    )
    return appointment_view(item)


def inbox(principal: Principal, event: dict[str, Any], *, people: People) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    data = booking()
    data.clinic(principal.tenant_id, clinic_id)
    subject = Subject(
        tenant_id=principal.tenant_id, clinic_id=clinic_id, clinician_profile_id=principal.staff_id
    )
    permissions.require(principal, "procedure.size_and_place", subject)
    found = [
        a
        for a in data.clinic_day(principal.tenant_id, clinic_id, REQUESTS)
        if a.get("state") == "REQUESTED"
    ]
    found.sort(key=lambda a: str(a.get("createdAt")))
    return {
        "clinicId": clinic_id,
        "count": len(found),
        "appointments": [appointment_view(a) for a in found],
        "patients": people.patient_names(
            principal.tenant_id, [str(a["patientProfileId"]) for a in found]
        ),
    }


def _requested(
    principal: Principal, event: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    data = booking()
    appointment = data.appointment(principal.tenant_id, requests.path_parameter(event, "id"))
    if appointment.get("state") != "REQUESTED":
        raise Conflict("that request has already been dealt with")
    body = requests.json_body(event)
    return appointment, body


def place(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """Size and place a request: a clinician, a start and a length (FR-STF-15)."""
    appointment, body = _requested(principal, event)
    data = booking()
    tenant_id = principal.tenant_id
    clinician_id = str(body.get("clinicianProfileId") or "")
    membership = data.bookable_clinician(tenant_id, clinician_id)
    clinic_id = str(membership["clinicId"])
    subject = Subject(
        tenant_id=tenant_id,
        patient_profile_id=appointment.get("patientProfileId"),
        clinician_profile_id=clinician_id,
        clinic_id=clinic_id,
    )
    caller = permissions.effective_principal(principal, subject)
    if not caller.is_staff:
        raise Forbidden("a request is placed by staff")
    permissions.require(caller, "procedure.size_and_place", subject)
    if clinic_id != appointment.get("clinicId"):
        raise Invalid("place it with a clinician of the unit it was asked of")

    kind = data.appointment_type(tenant_id, str(appointment["appointmentTypeId"]))
    duration = body.get("durationUnits", kind.get("durationUnits"))
    if isinstance(duration, bool) or not isinstance(duration, int) or not 1 <= int(duration) <= 48:
        raise Invalid("durationUnits is the procedure's length in grid units, 1 to 48")
    start_at = rules.parse_instant(body.get("startAt"), name="startAt")
    if start_at <= data.now():
        raise Invalid("a procedure is placed at a time still to come")
    minutes = rules.grid_unit_minutes(data.tenant(tenant_id))
    rules.require_on_grid(start_at, minutes=minutes)
    occupancy = rules.occupancy(
        start_at,
        duration_units=int(duration),
        buffer_units=int(kind.get("bufferUnits") or 0),
        minutes=minutes,
    )
    lifecycle.require("appointment", "REQUESTED", "BOOKED")
    now = rules.instant(data.now())
    appointment_id = str(appointment["appointmentId"])
    local_day = occupancy.start_at.astimezone(data.zone(tenant_id)).date().isoformat()
    moved = event_item(
        appointment_id=appointment_id,
        tenant_id=tenant_id,
        kind="PLACED",
        from_state="REQUESTED",
        to_state="BOOKED",
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, "procedure.size_and_place"),
        reason=None,
        occurred_at=now,
    )
    expires = int((occupancy.held_until + LOCK_GRACE).timestamp())
    changes = {
        "state": "BOOKED",
        "clinicianProfileId": clinician_id,
        "startAt": rules.instant(occupancy.start_at),
        "endAt": rules.instant(occupancy.end_at),
        "clinicDay": f"{clinic_id}#{local_day}",
        "placedAt": now,
        "placedByPersonId": caller.person_id,
        "version": int(appointment.get("version", 1)) + 1,
    }
    data.repository.change_together(
        creates=[
            *(
                (
                    keys.slot_lock(tenant_id, clinician_id, unit),
                    lock_item(
                        tenant_id=tenant_id,
                        clinician_profile_id=clinician_id,
                        unit=unit,
                        appointment_id=appointment_id,
                        expires_at=expires,
                    ),
                )
                for unit in occupancy.units
            ),
            (
                keys.appointment_event(
                    tenant_id, appointment_id, now, str(moved["appointmentEventId"])
                ),
                moved,
            ),
        ],
        updates=[(keys.appointment(tenant_id, appointment_id), changes, ("state", "REQUESTED"))],
        conflict="that time is no longer free, or the request was placed already",
    )
    return appointment_view({**appointment, **changes})


def decline(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """Decline a request, saying why; the patient is told (lifecycle: staff decline)."""
    appointment, body = _requested(principal, event)
    subject = Subject(
        tenant_id=principal.tenant_id,
        patient_profile_id=appointment.get("patientProfileId"),
        clinic_id=appointment.get("clinicId"),
        clinician_profile_id=principal.staff_id,
    )
    caller = permissions.effective_principal(principal, subject)
    if not caller.is_staff:
        raise Forbidden("a request is declined by staff")
    permissions.require(caller, "procedure.size_and_place", subject)
    reason = rules.require_reason(
        str(body.get("reason") or "") or None, by_staff=True, action="decline"
    )
    data = booking()
    declined, _event = data.move(
        tenant_id=principal.tenant_id,
        appointment=appointment,
        to_state="DECLINED",
        kind="DECLINED",
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, "procedure.size_and_place"),
        reason=reason,
        fields={"declineReason": reason, "declinedAt": rules.instant(data.now())},
    )
    return appointment_view(declined)
