"""What a booking must be before it can hold time.

A specialist appointment holds a clinician and a start, and it holds them by
locking N consecutive grid units in one transaction (ADR 0004). This module
decides which units a request occupies and refuses a request that may not have
them; the transaction itself is in atria.data.booking.

Two things the appointment type owns are applied here rather than in the form,
because a form can be skipped and this cannot: the notice and advance window a
type may be booked within, and who may book it at all (D-05).

Availability is deliberately not checked here. The locks are what stop two
patients holding one unit; whether the clinician works that hour is the
schedule's question and is enforced where availability lives.

The clinic is not part of a request. It comes from the chosen clinician's
membership, because the clinic decides which staff scope reaches the record and
a caller supplied value would let a booking be placed outside the caller's own
clinic.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from atria.core.errors import Invalid

# DynamoDB hands every number back as a Decimal, so a check against int alone
# would refuse the tenant's own configuration.
NUMBERS = (int, float, Decimal)

# Guard SERVER_ASSIGNED_ORDER: the server derives these, so a request that
# supplies one is rejected rather than having the value quietly dropped. clinicId
# is here because it comes from the clinician's membership: a caller that
# believes it chose the clinic has to be told that it did not.
DERIVED_FIELDS = (
    "appointmentId",
    "endAt",
    "state",
    "version",
    "position",
    "bookedByPersonId",
    "clinicId",
)

CHANNELS = ("ONLINE", "WALK_IN", "PHONE", "REFERRAL")

BOOKABLE_BY = ("PATIENT", "STAFF", "BOTH")

DEFAULT_GRID_UNIT_MINUTES = 10

# A DynamoDB transaction carries at most 100 items, and a booking writes the
# appointment and its first event alongside the locks.
MAX_LOCKED_UNITS = 98


@dataclass(frozen=True, slots=True)
class BookingRequest:
    """A validated request to book a specialist appointment."""

    patient_profile_id: str
    appointment_type_id: str
    clinician_profile_id: str
    start_at: dt.datetime
    channel: str
    referral_id: str | None = None
    care_context_id: str | None = None
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class Occupancy:
    """The time an appointment takes, and the time it holds.

    They are not the same: endAt comes from the type's durationUnits and is
    what the patient is told, while the locked units also cover the buffer the
    type holds after it, so the next booking cannot start inside the turnaround.
    held_until is where those locks stop, which is end_at plus that buffer.
    """

    start_at: dt.datetime
    end_at: dt.datetime
    held_until: dt.datetime
    units: tuple[str, ...]


def instant(value: dt.datetime) -> str:
    """The wire and key form of an instant. Always UTC, always to the second."""
    return value.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_instant(value: object, *, name: str) -> dt.datetime:
    """Read an ISO 8601 instant that carries an offset."""
    if not isinstance(value, str) or not value.strip():
        raise Invalid(f"{name} is required, as an ISO 8601 instant")
    try:
        parsed = dt.datetime.fromisoformat(value.strip())
    except ValueError as exc:
        raise Invalid(f"{name} is not a valid ISO 8601 instant") from exc
    if parsed.tzinfo is None:
        # A local time would be read as UTC and silently book the wrong hour.
        raise Invalid(f"{name} must carry a UTC offset, for example 2026-03-04T08:00:00Z")
    return parsed.astimezone(dt.UTC)


def grid_unit_minutes(tenant: dict[str, object]) -> int:
    """The tenant's calendar resolution (D-04)."""
    value = tenant.get("gridUnitMinutes", DEFAULT_GRID_UNIT_MINUTES)
    if isinstance(value, bool) or not isinstance(value, NUMBERS):
        raise Invalid("the tenant's gridUnitMinutes is not a number")
    minutes = int(value)
    if minutes <= 0 or 60 % minutes:
        # The grid has to divide an hour, or unit boundaries drift across the day.
        raise Invalid("the tenant's gridUnitMinutes must divide an hour")
    return minutes


def occupancy(
    start_at: dt.datetime,
    *,
    duration_units: int,
    buffer_units: int,
    minutes: int,
) -> Occupancy:
    """Which units a booking occupies, and when the patient is seen until."""
    if duration_units <= 0:
        raise Invalid("this appointment type carries no duration, so it cannot hold a slot")
    held = duration_units + max(0, buffer_units)
    if held > MAX_LOCKED_UNITS:
        raise Invalid(
            "this appointment type is too long to book in one transaction",
            detail={"units": held, "maximum": MAX_LOCKED_UNITS},
        )
    step = dt.timedelta(minutes=minutes)
    return Occupancy(
        start_at=start_at,
        end_at=start_at + step * duration_units,
        held_until=start_at + step * held,
        units=tuple(instant(start_at + step * n) for n in range(held)),
    )


def require_on_grid(start_at: dt.datetime, *, minutes: int) -> None:
    """A start that is not on a unit boundary would half occupy two units."""
    if start_at.second or start_at.microsecond or (start_at.hour * 60 + start_at.minute) % minutes:
        raise Invalid(
            "startAt must fall on a grid unit boundary",
            detail={"gridUnitMinutes": minutes},
        )


def require_bookable(
    appointment_type: dict[str, object],
    *,
    by_patient: bool,
    now: dt.datetime,
    start_at: dt.datetime,
) -> None:
    """Apply the window and the audience the appointment type sets (D-05)."""
    if not appointment_type.get("active", True):
        raise Invalid("that appointment type is not currently offered")

    bookable_by = str(appointment_type.get("bookableBy", "BOTH")).upper()
    if bookable_by not in BOOKABLE_BY:
        raise Invalid("that appointment type has no valid bookableBy setting")
    if by_patient and bookable_by == "STAFF":
        # A procedure is sized and placed by staff, never self booked (ADR 0005).
        raise Invalid("that appointment type is booked by staff, not by a patient")
    if not by_patient and bookable_by == "PATIENT":
        raise Invalid("that appointment type is booked by the patient")

    notice = _whole(appointment_type.get("minNoticeMinutes"), name="minNoticeMinutes")
    if notice and start_at < now + dt.timedelta(minutes=notice):
        raise Invalid(
            "that start is sooner than the appointment type allows",
            detail={"minNoticeMinutes": notice},
        )

    advance = _whole(appointment_type.get("maxAdvanceDays"), name="maxAdvanceDays")
    if advance and start_at > now + dt.timedelta(days=advance):
        raise Invalid(
            "that start is further ahead than the appointment type allows",
            detail={"maxAdvanceDays": advance},
        )


def validate(
    body: dict[str, object], *, by_patient: bool, own_patient_profile_id: str | None
) -> BookingRequest:
    """Turn a request body into a BookingRequest, or raise Invalid.

    A patient books for themselves and nobody else, so the patient profile is
    taken from the caller rather than from the body when the caller is a patient.
    """
    supplied = [name for name in DERIVED_FIELDS if name in body]
    if supplied:
        raise Invalid(
            "those fields are set by the server and cannot be supplied",
            detail={"fields": supplied},
        )

    if by_patient:
        if own_patient_profile_id is None:
            raise Invalid("this account holds no patient profile")
        patient_profile_id = own_patient_profile_id
    else:
        patient_profile_id = _required(body, "patientProfileId")

    channel = (_text(body, "channel") or "ONLINE").upper()
    if channel not in CHANNELS:
        raise Invalid("unknown channel", detail={"allowed": list(CHANNELS)})

    return BookingRequest(
        patient_profile_id=patient_profile_id,
        appointment_type_id=_required(body, "appointmentTypeId"),
        clinician_profile_id=_required(body, "clinicianProfileId"),
        start_at=parse_instant(body.get("startAt"), name="startAt"),
        channel=channel,
        referral_id=_text(body, "referralId"),
        care_context_id=_text(body, "careContextId"),
        reason=_text(body, "reason"),
    )


def _text(body: dict[str, object], name: str) -> str | None:
    value = body.get(name)
    if value is None:
        return None
    if not isinstance(value, str):
        raise Invalid(f"{name} must be text")
    return value.strip() or None


def _required(body: dict[str, object], name: str) -> str:
    text = _text(body, name)
    if text is None:
        raise Invalid(f"{name} is required")
    return text


def _whole(value: object, *, name: str) -> int:
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, NUMBERS):
        raise Invalid(f"{name} is not a number")
    return int(value)
