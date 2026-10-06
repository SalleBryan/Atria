"""What the API returns for an appointment, wherever it is read.

Listed rather than passing the record through, because the record also carries
storage fields that are not part of the contract: index keys, the reminder's
schedule reference, the lock expiry. The booking and the schedule services both
return appointments, and both render them from here.
"""

from __future__ import annotations

from typing import Any

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
    # A queue ticket: its place and when to arrive (FR-BKG-11).
    "position",
    "arrivalWindowStart",
    "arrivalWindowEnd",
    # A procedure request: what was asked, and why it was declined (FR-BKG-14).
    "requestNote",
    "declineReason",
)


def appointment_view(appointment: dict[str, Any]) -> dict[str, Any]:
    """The appointment as the contract describes it, and nothing further."""
    return {name: appointment.get(name) for name in VIEW_FIELDS}


def event_view(event: dict[str, Any], *, staff: bool, person_id: str | None) -> dict[str, Any]:
    """One step in a visit's history, for its timeline (APPOINTMENT_EVENT).

    Staff read who acted. A patient reads only the role that acted and whether
    it was them, and a reason only when it was their own: a staff member's
    reason is written for colleagues (D-10 rule 4), and the patient is told
    in general terms by the notice instead.
    """
    own = person_id is not None and event.get("actorPersonId") == person_id
    shown = {
        "appointmentEventId": event.get("appointmentEventId"),
        "kind": event.get("kind"),
        "fromState": event.get("fromState"),
        "toState": event.get("toState"),
        "actorRole": event.get("actorRole"),
        "byYou": own,
        "occurredAt": event.get("occurredAt"),
        # A move keeps where the visit was (FR-VIS-07).
        "previousStartAt": event.get("previousStartAt"),
        "rescheduledBy": event.get("rescheduledBy"),
        "reason": event.get("reason") if staff or own else None,
    }
    if staff:
        shown["actorPersonId"] = event.get("actorPersonId")
    return shown
