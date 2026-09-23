"""Appointment, slot lock and appointment event records.

The whole point of this module is one transaction. A specialist appointment of
N grid units writes N slot lock items, the appointment and its first event
together, every one of them conditional on not already existing (ADR 0004). Two
patients racing for the same minute therefore produce one booking and one 409,
and never two appointments or a lock without the appointment it belongs to.

The locks carry a TTL set just past the last unit they hold. A lock is
meaningless once the time it guards has passed, so expiring them keeps the
table from growing a row per booked minute forever.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core import booking as rules
from atria.core.errors import Conflict, Invalid
from atria.data import keys
from atria.data.people import new_id
from atria.data.repository import Item, Repository

# Statuses a clinician may be booked in. A suspended or ended membership is
# refused: the account cannot be seen by a patient, so it cannot be given one.
BOOKABLE_STATUSES = ("INVITED", "ACTIVE")

# Long enough that a lock outlives any clock skew between the booking and the
# appointment it guards.
LOCK_GRACE = dt.timedelta(hours=6)


def reference(appointment_id: str) -> str:
    """The reference a patient is given and quotes at the desk (FR-BKG-01).

    Derived from the identifier rather than counted, because a counter needs a
    sequence item that every booking in the tenant contends on, and the point
    of the reference is only that a human can read it back.
    """
    return f"APT-{appointment_id.rsplit('-', 1)[-1][:10].upper()}"


def appointment_item(
    *,
    appointment_id: str,
    tenant_id: str,
    clinic_id: str,
    request: rules.BookingRequest,
    occupancy: rules.Occupancy,
    booked_by_person_id: str,
    booked_by_role: str | None,
    created_at: str,
) -> Item:
    """The appointment record. A specialist booking, so it carries no session."""
    return {
        "type": "APPOINTMENT",
        "appointmentId": appointment_id,
        "reference": reference(appointment_id),
        "tenantId": tenant_id,
        "clinicId": clinic_id,
        "patientProfileId": request.patient_profile_id,
        "appointmentTypeId": request.appointment_type_id,
        "clinicianProfileId": request.clinician_profile_id,
        "sessionId": None,
        "startAt": rules.instant(occupancy.start_at),
        "endAt": rules.instant(occupancy.end_at),
        "state": "BOOKED",
        "channel": request.channel,
        "bookedByPersonId": booked_by_person_id,
        "bookedByRole": booked_by_role,
        "referralId": request.referral_id,
        "careContextId": request.care_context_id,
        "version": 1,
        "createdAt": created_at,
    }


def event_item(
    *,
    appointment_id: str,
    tenant_id: str,
    kind: str,
    from_state: str | None,
    to_state: str,
    actor_person_id: str,
    actor_role: str | None,
    reason: str | None,
    occurred_at: str,
) -> Item:
    """One transition, with who caused it. Drives the patient's timeline."""
    return {
        "type": "APPOINTMENT_EVENT",
        "appointmentEventId": new_id("ae"),
        "appointmentId": appointment_id,
        "tenantId": tenant_id,
        "kind": kind,
        "fromState": from_state,
        "toState": to_state,
        "actorPersonId": actor_person_id,
        "actorRole": actor_role,
        "reason": reason,
        "occurredAt": occurred_at,
    }


def lock_item(
    *, tenant_id: str, clinician_profile_id: str, unit: str, appointment_id: str, expires_at: int
) -> Item:
    return {
        "type": "SLOT_LOCK",
        "lockKey": f"{tenant_id}#{clinician_profile_id}",
        "unit": unit,
        "appointmentId": appointment_id,
        "tenantId": tenant_id,
        "expiresAt": expires_at,
    }


class Booking:
    """Reads and writes of appointments and the locks that hold their time."""

    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    def now(self) -> dt.datetime:
        return self._clock()

    # ------------------------------------------------------------------ reads
    def tenant(self, tenant_id: str) -> Item:
        return self._repo.require(keys.tenant(tenant_id), what="tenant")

    def appointment_type(self, tenant_id: str, type_id: str) -> Item:
        return self._repo.require(
            keys.appointment_type(tenant_id, type_id), what="appointment type"
        )

    def patient_profile(self, tenant_id: str, patient_profile_id: str) -> Item:
        return self._repo.require(
            keys.patient_profile(tenant_id, patient_profile_id), what="patient"
        )

    def appointment(self, tenant_id: str, appointment_id: str) -> Item:
        return self._repo.require(keys.appointment(tenant_id, appointment_id), what="appointment")

    def clinic(self, tenant_id: str, clinic_id: str) -> Item:
        return self._repo.require(keys.clinic(tenant_id, clinic_id), what="clinic")

    def region_pack(self, code: str) -> Item | None:
        return self._repo.get(keys.region_pack(code))

    def locked_units(
        self, tenant_id: str, clinician_profile_id: str, units: list[str]
    ) -> set[str]:
        """Which of these grid units are already held.

        One read for the whole day: a lock is its own partition, so there is no
        query that spans them and a batch get is the only way to ask.
        """
        wanted = [keys.slot_lock(tenant_id, clinician_profile_id, unit) for unit in units]
        found = self._repo.get_many(wanted)
        return {
            unit
            for unit, key in zip(units, wanted, strict=True)
            if (key.pk, key.sk) in found
        }

    def exceptions(self, tenant_id: str, clinician_profile_id: str) -> list[Item]:
        """A clinician's availability exceptions. Marking one starts a disruption (D-03)."""
        return self._repo.query_partition(
            f"{keys.TENANT}{tenant_id}#CLIN#{clinician_profile_id}", sk_prefix="EXC#"
        )

    def bookable_clinician(self, tenant_id: str, clinician_profile_id: str) -> Item:
        """The clinician's membership, which is also where their clinic comes from.

        Reading the membership rather than the profile is deliberate: the
        profile says what the clinician does, the membership says where they
        work and whether the account is still in use.
        """
        membership = self._repo.require(
            keys.staff_membership(tenant_id, clinician_profile_id), what="clinician"
        )
        if "CLINICIAN" not in membership.get("roles", []):
            raise Invalid("that staff account is not a clinician")
        if membership.get("status") not in BOOKABLE_STATUSES:
            raise Conflict("that clinician is not currently taking appointments")
        if not membership.get("clinicId"):
            raise Invalid("that clinician is not attached to a clinic")
        return membership

    # ----------------------------------------------------------------- writes
    def book_specialist(
        self,
        *,
        tenant_id: str,
        clinic_id: str,
        request: rules.BookingRequest,
        occupancy: rules.Occupancy,
        actor_person_id: str,
        actor_role: str | None,
    ) -> tuple[Item, Item]:
        """Lock every unit and write the appointment, or do none of it.

        A unit already locked means somebody else got there first, which is a
        409 and not an error: the client re-reads the day and offers what is
        left.
        """
        appointment_id = new_id("a")
        # One format for every instant the booking path writes, so a record and
        # the wire agree and a sort key stays comparable.
        occurred_at = rules.instant(self._clock())
        expires_at = int((occupancy.held_until + LOCK_GRACE).timestamp())

        appointment = appointment_item(
            appointment_id=appointment_id,
            tenant_id=tenant_id,
            clinic_id=clinic_id,
            request=request,
            occupancy=occupancy,
            booked_by_person_id=actor_person_id,
            booked_by_role=actor_role,
            created_at=occurred_at,
        )
        event = event_item(
            appointment_id=appointment_id,
            tenant_id=tenant_id,
            kind="BOOKED",
            from_state=None,
            to_state="BOOKED",
            actor_person_id=actor_person_id,
            actor_role=actor_role,
            reason=request.reason,
            occurred_at=occurred_at,
        )

        writes: list[tuple[keys.Key, Item]] = [
            (
                keys.slot_lock(tenant_id, request.clinician_profile_id, unit),
                lock_item(
                    tenant_id=tenant_id,
                    clinician_profile_id=request.clinician_profile_id,
                    unit=unit,
                    appointment_id=appointment_id,
                    expires_at=expires_at,
                ),
            )
            for unit in occupancy.units
        ]
        writes.append((keys.appointment(tenant_id, appointment_id), appointment))
        writes.append(
            (keys.appointment_event(tenant_id, appointment_id, occurred_at), event)
        )

        try:
            self._repo.write_together(writes)
        except Conflict as exc:
            # Only the locks can collide: the appointment and its event carry a
            # fresh identifier, so a clash is always a unit somebody else took.
            raise Conflict(
                "that time is no longer free",
                detail={
                    "clinicianProfileId": request.clinician_profile_id,
                    "startAt": rules.instant(occupancy.start_at),
                    "units": len(occupancy.units),
                },
            ) from exc
        return appointment, event
