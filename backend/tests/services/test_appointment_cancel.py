"""Cancelling frees the time, once, and says what the patient is owed.

Verifies FR-VIS-03 (a booked appointment is cancelled, the update is
conditional on its state, a second cancel returns 409, and the slot locks are
removed so the time is free again) and the entitlement half of acceptance test
BR-06.

The reminder teardown and the cancellation email in FR-VIS-04 arrive with the
reminder and message work; nothing here pretends to cover them.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from atria.core import booking as rules
from atria.core import staff as staff_rules
from atria.data import keys
from atria.data.booking import Booking
from atria.data.people import People
from atria.services.booking import appointments as service
from atria.services.directory import clinicians as directory

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
PATIENT = "pp-1"
TYPE_ID = "at-spec-first"

# The appointment starts well ahead, so a cancellation is in window unless a
# test moves the clock.
NOW = dt.datetime(2026, 3, 1, 9, 0, tzinfo=dt.UTC)
START = "2026-03-04T08:00:00Z"

CLOCK = {"now": NOW}


@pytest.fixture
def wired(monkeypatch, repository):
    booking = Booking(repository, clock=lambda: CLOCK["now"])
    CLOCK["now"] = NOW
    monkeypatch.setattr(service, "_booking", booking)
    monkeypatch.setattr(directory, "_booking", booking)
    monkeypatch.setattr(directory, "_people", People(repository))

    repository.put(
        keys.tenant(TENANT),
        {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10, "regionPackCode": "CM"},
    )
    repository.put(
        keys.region_pack("CM"), {"type": "REGION_PACK", "code": "CM", "timezone": "Africa/Douala"}
    )
    repository.put(
        keys.clinic(TENANT, DOUALA),
        {
            "type": "CLINIC",
            "clinicId": DOUALA,
            "tenantId": TENANT,
            "openingHours": {str(d): {"start": "08:00", "end": "17:00"} for d in range(7)},
        },
    )
    repository.put(
        keys.appointment_type(TENANT, TYPE_ID),
        {
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": TYPE_ID,
            "tenantId": TENANT,
            "durationUnits": 3,
            "bufferUnits": 1,
            "bookableBy": "BOTH",
            "minNoticeMinutes": 30,
            "maxAdvanceDays": 60,
            "cancellationWindowMinutes": 1440,
            "active": True,
        },
    )
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {"type": "PATIENT_PROFILE", "patientProfileId": PATIENT, "tenantId": TENANT},
    )
    _person, membership = People(repository).create_staff_account(
        tenant_id=TENANT,
        account=staff_rules.StaffAccount(
            given_name="Paul",
            family_name="Etoa",
            phone_e164="+237600000010",
            roles=("CLINICIAN",),
            clinic_id=DOUALA,
            specialty="Paediatrics",
            registration_year=2012,
            ordre_number="CM-ONMC-1",
            languages=("fr",),
        ),
    )
    return repository, membership["staffMembershipId"]


def patient_context(**extra):
    base = {
        "personId": "p-patient",
        "tenantId": TENANT,
        "roles": "PATIENT",
        "patientProfileId": PATIENT,
    }
    base.update(extra)
    return base


def staff_context(**extra):
    base = {
        "personId": "p-rec",
        "tenantId": TENANT,
        "roles": "RECEPTIONIST",
        "staffId": "s-rec-1",
        "clinicId": DOUALA,
    }
    base.update(extra)
    return base


def book(clinician_id: str, *, start: str = START) -> dict:
    result = service.handler(
        {
            "httpMethod": "POST",
            "resource": "/appointments",
            "body": json.dumps(
                {
                    "appointmentTypeId": TYPE_ID,
                    "clinicianProfileId": clinician_id,
                    "startAt": start,
                }
            ),
            "requestContext": {"authorizer": patient_context()},
        },
        None,
    )
    assert result["statusCode"] == 201, result["body"]
    return json.loads(str(result["body"]))


def cancel(appointment_id: str, *, context=None, body=None):
    return service.handler(
        {
            "httpMethod": "DELETE",
            "resource": "/appointments/{id}",
            "pathParameters": {"id": appointment_id},
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": context or patient_context()},
        },
        None,
    )


def body_of(result) -> dict:
    return json.loads(str(result["body"]))


class TestCancel:
    def test_a_patient_cancels_their_own_appointment(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = cancel(booked["appointmentId"])
        assert result["statusCode"] == 200
        assert body_of(result)["state"] == "PATIENT_CANCELLED"

    def test_fr_vis_03_the_locks_are_removed_so_the_time_is_free(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        held = rules.occupancy(
            rules.parse_instant(START, name="startAt"),
            duration_units=3,
            buffer_units=1,
            minutes=10,
        )
        assert all(
            repository.get(keys.slot_lock(TENANT, clinician, unit)) is not None
            for unit in held.units
        )

        cancel(booked["appointmentId"])
        assert all(
            repository.get(keys.slot_lock(TENANT, clinician, unit)) is None
            for unit in held.units
        )

    def test_the_same_start_can_be_booked_again_afterwards(self, wired):
        _repo, clinician = wired
        first = book(clinician)
        cancel(first["appointmentId"])
        again = book(clinician)
        assert again["appointmentId"] != first["appointmentId"]

    def test_the_start_is_offered_again_by_the_slot_search(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        cancel(booked["appointmentId"])
        result = directory.handler(
            {
                "httpMethod": "GET",
                "resource": "/clinicians/{id}/slots",
                "pathParameters": {"id": clinician},
                "queryStringParameters": {"date": "2026-03-04", "typeId": TYPE_ID},
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        offered = {s["startAt"] for s in body_of(result)["slots"]}
        assert START in offered

    def test_fr_vis_03_a_second_cancel_is_a_conflict(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        assert cancel(booked["appointmentId"])["statusCode"] == 200
        second = cancel(booked["appointmentId"])
        assert second["statusCode"] == 409
        assert body_of(second)["code"] == "conflict"

    def test_the_appointment_is_kept_not_deleted(self, wired):
        """FR-VIS-08: closed appointments are retained."""
        _repo, clinician = wired
        booked = book(clinician)
        cancel(booked["appointmentId"])
        found = service.handler(
            {
                "httpMethod": "GET",
                "resource": "/appointments/{id}",
                "pathParameters": {"id": booked["appointmentId"]},
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        assert found["statusCode"] == 200
        assert body_of(found)["state"] == "PATIENT_CANCELLED"

    def test_the_transition_is_recorded_as_an_event(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        cancel(booked["appointmentId"])
        events = repository.query_partition(
            keys.appointment(TENANT, booked["appointmentId"]).pk, sk_prefix="EVENT#"
        )
        kinds = {e["kind"] for e in events}
        assert kinds == {"BOOKED", "CANCELLED"}
        cancelled = next(e for e in events if e["kind"] == "CANCELLED")
        assert cancelled["entitlement"] == "FULL"
        assert cancelled["toState"] == "PATIENT_CANCELLED"


class TestEntitlement:
    def test_a_cancellation_in_the_window_is_full(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        found = body_of(cancel(booked["appointmentId"]))
        assert found["outcome"] == "CANCELLED_IN_WINDOW"
        assert found["entitlement"] == "FULL"

    def test_a_late_cancellation_is_partial(self, wired):
        """The type allows 24 hours; this one is two hours before the start."""
        _repo, clinician = wired
        booked = book(clinician)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 6, 0, tzinfo=dt.UTC)
        found = body_of(cancel(booked["appointmentId"]))
        assert found["outcome"] == "CANCELLED_LATE"
        assert found["entitlement"] == "PARTIAL"

    def test_a_clinic_cancellation_is_always_full(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 6, 0, tzinfo=dt.UTC)
        found = body_of(
            cancel(
                booked["appointmentId"],
                context=staff_context(),
                body={"cancelledBy": "CLINIC", "reason": "the clinician is unwell"},
            )
        )
        assert found["state"] == "CLINIC_CANCELLED"
        assert found["entitlement"] == "FULL"

    def test_the_version_stays_a_number_after_a_round_trip(self, wired):
        """The cancelled record is read back from the table, where every number
        is a Decimal; stringifying it broke the contract the create obeyed."""
        _repo, clinician = wired
        booked = book(clinician)
        assert isinstance(booked["version"], int)
        cancelled = body_of(cancel(booked["appointmentId"]))
        assert isinstance(cancelled["version"], int)

    def test_nothing_is_settled(self, wired):
        """ADR 0007: the entitlement is a record, not money moved."""
        _repo, clinician = wired
        booked = book(clinician)
        found = body_of(cancel(booked["appointmentId"]))
        assert "settled" not in found
        assert "Nothing is settled" in found["note"]


class TestWhoMayCancel:
    def test_staff_must_say_who_cancelled(self, wired):
        """The entitlement differs, so guessing would over or under compensate."""
        _repo, clinician = wired
        booked = book(clinician)
        result = cancel(booked["appointmentId"], context=staff_context(), body={})
        assert result["statusCode"] == 400
        assert "PATIENT" in body_of(result)["detail"]["allowed"]

    def test_staff_can_cancel_on_the_patients_behalf(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        found = body_of(
            cancel(
                booked["appointmentId"],
                context=staff_context(),
                body={"cancelledBy": "PATIENT"},
            )
        )
        assert found["state"] == "PATIENT_CANCELLED"
        assert found["bookedByRole"] is None

    def test_a_patient_cannot_claim_the_clinic_cancelled(self, wired):
        """It would turn a late cancellation into a full entitlement."""
        _repo, clinician = wired
        booked = book(clinician)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 6, 0, tzinfo=dt.UTC)
        found = body_of(cancel(booked["appointmentId"], body={"cancelledBy": "CLINIC"}))
        assert found["state"] == "PATIENT_CANCELLED"
        assert found["entitlement"] == "PARTIAL"

    def test_a_patient_cannot_cancel_somebody_elses(self, wired, repository):
        _repo, clinician = wired
        booked = book(clinician)
        result = cancel(
            booked["appointmentId"],
            context=patient_context(patientProfileId="pp-somebody-else"),
        )
        assert result["statusCode"] == 403

    def test_a_receptionist_of_another_clinic_cannot_cancel(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = cancel(
            booked["appointmentId"],
            context=staff_context(clinicId="c-yaounde-01"),
            body={"cancelledBy": "CLINIC"},
        )
        assert result["statusCode"] == 403

    def test_an_unknown_appointment_is_not_found(self, wired):
        assert cancel("a-nope")["statusCode"] == 404
