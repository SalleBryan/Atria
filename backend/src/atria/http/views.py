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
)


def appointment_view(appointment: dict[str, Any]) -> dict[str, Any]:
    """The appointment as the contract describes it, and nothing further."""
    return {name: appointment.get(name) for name in VIEW_FIELDS}
