"""A booking holds its time atomically, or it does not happen at all.

Verifies FR-BKG-02 (N grid units and the appointment are written in one
transaction, each lock conditional on not existing; if any unit is taken the
request fails with 409 and nothing is written) and FR-BKG-07 (a staff booking
is attributed to the staff account).

Runs against moto, on a table built from the specification's key design, so the
conditional writes and the transaction are exercised rather than mocked away.
"""

from __future__ import annotations

import datetime as dt

import pytest

from atria.core import booking as rules
from atria.core.errors import Conflict, Invalid, NotFound
from atria.data import keys
from atria.data.booking import Booking

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
CLINIC = "c-douala-01"
CLINICIAN = "s-clin-1"
PATIENT = "pp-1"
ACTOR = "p-reception-1"

NOW = dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
START = dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC)


@pytest.fixture
def booking(repository):
    return Booking(repository, clock=lambda: NOW)


@pytest.fixture
def seeded(repository):
    """A tenant, a clinic's clinician and a patient, which every booking needs."""
    repository.put(
        keys.tenant(TENANT), {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10}
    )
    repository.put(
        keys.staff_membership(TENANT, CLINICIAN),
        {
            "type": "STAFF_MEMBERSHIP",
            "staffMembershipId": CLINICIAN,
            "personId": "p-clin-1",
            "tenantId": TENANT,
            "clinicId": CLINIC,
            "roles": ["CLINICIAN"],
            "status": "ACTIVE",
        },
    )
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {"type": "PATIENT_PROFILE", "patientProfileId": PATIENT, "tenantId": TENANT},
    )
    return repository


def request(**overrides) -> rules.BookingRequest:
    fields = {
        "patient_profile_id": PATIENT,
        "appointment_type_id": "at-spec-first",
        "clinician_profile_id": CLINICIAN,
        "start_at": START,
        "channel": "ONLINE",
    }
    return rules.BookingRequest(**{**fields, **overrides})


def occupancy(duration_units: int = 3, buffer_units: int = 0) -> rules.Occupancy:
    return rules.occupancy(
        START, duration_units=duration_units, buffer_units=buffer_units, minutes=10
    )


def book(booking: Booking, **overrides):
    return booking.book_specialist(
        tenant_id=TENANT,
        clinic_id=CLINIC,
        request=overrides.pop("request", request()),
        occupancy=overrides.pop("occupancy", occupancy()),
        actor_person_id=overrides.pop("actor_person_id", ACTOR),
        actor_role=overrides.pop("actor_role", "RECEPTIONIST"),
    )


class TestBookSpecialist:
    def test_the_appointment_is_written_in_the_booked_state(self, seeded, booking):
        appointment, _event = book(booking)
        assert appointment["state"] == "BOOKED"
        assert appointment["startAt"] == "2026-03-04T08:00:00Z"
        assert appointment["endAt"] == "2026-03-04T08:30:00Z"
        assert appointment["clinicId"] == CLINIC

    def test_fr_bkg_01_the_patient_is_given_a_reference_they_can_quote(self):
        assert rules  # the reference is derived, so it needs no table
        from atria.data.booking import reference

        assert reference("a-0123456789abcdef").startswith("APT-")
        assert reference("a-0123456789abcdef") == "APT-0123456789"

    def test_a_specialist_booking_carries_no_session(self, seeded, booking):
        """The appointment holds a clinician and a time, or a session, never both."""
        appointment, _event = book(booking)
        assert appointment["sessionId"] is None
        assert appointment["clinicianProfileId"] == CLINICIAN

    def test_fr_bkg_02_one_lock_is_written_for_every_unit(self, seeded, booking, repository):
        _appointment, _event = book(booking, occupancy=occupancy(duration_units=3))
        for unit in occupancy(duration_units=3).units:
            assert repository.get(keys.slot_lock(TENANT, CLINICIAN, unit)) is not None

    def test_the_buffer_is_locked_as_well_as_the_duration(self, seeded, booking, repository):
        held = occupancy(duration_units=2, buffer_units=1)
        _appointment, _event = book(booking, occupancy=held)
        assert len(held.units) == 3
        assert repository.get(keys.slot_lock(TENANT, CLINICIAN, held.units[2])) is not None

    def test_every_lock_points_at_the_appointment_that_holds_it(self, seeded, booking, repository):
        appointment, _event = book(booking)
        for unit in occupancy().units:
            lock = repository.get(keys.slot_lock(TENANT, CLINICIAN, unit))
            assert lock["appointmentId"] == appointment["appointmentId"]

    def test_nothing_that_is_kept_carries_an_expiry(self, seeded, booking, repository):
        """The table expires any item carrying expiresAt, so an appointment or
        an event that acquired one would delete itself. Booking history is
        retained for ten years (ADR 0008)."""
        appointment, event = book(booking)
        assert "expiresAt" not in appointment
        assert "expiresAt" not in event
        stored = repository.get(keys.appointment(TENANT, appointment["appointmentId"]))
        assert stored is not None
        assert "expiresAt" not in stored

    def test_a_lock_expires_after_the_time_it_guards(self, seeded, booking, repository):
        """A lock is meaningless once its minute has passed, so it is not kept."""
        held = occupancy()
        book(booking, occupancy=held)
        lock = repository.get(keys.slot_lock(TENANT, CLINICIAN, held.units[0]))
        assert int(lock["expiresAt"]) > int(held.held_until.timestamp())

    def test_the_first_event_records_the_booking(self, seeded, booking):
        _appointment, event = book(booking)
        assert event["kind"] == "BOOKED"
        assert event["fromState"] is None
        assert event["toState"] == "BOOKED"

    def test_fr_bkg_07_a_staff_booking_names_the_staff_account(self, seeded, booking):
        appointment, event = book(booking, actor_person_id="p-reception-9")
        assert appointment["bookedByPersonId"] == "p-reception-9"
        assert appointment["bookedByRole"] == "RECEPTIONIST"
        assert event["actorPersonId"] == "p-reception-9"

    def test_a_self_service_booking_records_no_staff_role(self, seeded, booking):
        """Blank is what the data model means by self service."""
        appointment, _event = book(booking, actor_role=None)
        assert appointment["bookedByRole"] is None


class TestDoubleBooking:
    def test_fr_bkg_02_a_taken_unit_refuses_the_whole_booking(self, seeded, booking):
        book(booking)
        with pytest.raises(Conflict):
            book(booking)

    def test_fr_bkg_02_the_refusal_names_the_time_rather_than_the_table(self, seeded, booking):
        book(booking)
        with pytest.raises(Conflict) as raised:
            book(booking)
        assert raised.value.detail["startAt"] == "2026-03-04T08:00:00Z"
        assert raised.value.detail["clinicianProfileId"] == CLINICIAN

    def test_fr_bkg_02_nothing_is_written_when_a_unit_is_taken(self, seeded, booking, repository):
        """The whole point of the transaction: no appointment, no partial locks."""
        book(booking)

        # An overlap of one unit only: the second booking starts two units in,
        # so its first unit collides and its other two do not.
        overlapping = rules.occupancy(
            START + dt.timedelta(minutes=20), duration_units=3, buffer_units=0, minutes=10
        )
        with pytest.raises(Conflict):
            book(booking, occupancy=overlapping)

        # A partial write would have taken these two, because only the first
        # unit of the attempt was already held.
        for unit in overlapping.units[1:]:
            assert repository.get(keys.slot_lock(TENANT, CLINICIAN, unit)) is None
        booked = repository.query_index("PatientIndex", "patientProfileId", PATIENT)
        assert len(booked) == 1

    def test_an_adjacent_booking_is_accepted(self, seeded, booking):
        """The unit after the last one held is free, so the next patient gets it."""
        first = occupancy(duration_units=3)
        book(booking, occupancy=first)
        after = rules.occupancy(
            first.held_until, duration_units=3, buffer_units=0, minutes=10
        )
        appointment, _event = book(booking, occupancy=after)
        assert appointment["startAt"] == "2026-03-04T08:30:00Z"

    def test_the_same_time_is_free_for_a_different_clinician(self, seeded, booking):
        """Locks are per clinician, so one clinic runs many rooms at once."""
        book(booking)
        appointment, _event = book(booking, request=request(clinician_profile_id="s-clin-2"))
        assert appointment["clinicianProfileId"] == "s-clin-2"


class TestBookableClinician:
    def test_the_clinic_comes_from_the_membership(self, seeded, booking):
        assert booking.bookable_clinician(TENANT, CLINICIAN)["clinicId"] == CLINIC

    def test_an_unknown_clinician_is_not_found(self, seeded, booking):
        with pytest.raises(NotFound):
            booking.bookable_clinician(TENANT, "s-nobody")

    def test_a_clinician_in_another_tenant_is_not_found(self, seeded, booking):
        with pytest.raises(NotFound):
            booking.bookable_clinician("t-other", CLINICIAN)

    def test_a_staff_account_that_is_not_a_clinician_is_refused(self, seeded, booking, repository):
        repository.put(
            keys.staff_membership(TENANT, "s-rec-1"),
            {
                "type": "STAFF_MEMBERSHIP",
                "staffMembershipId": "s-rec-1",
                "tenantId": TENANT,
                "clinicId": CLINIC,
                "roles": ["RECEPTIONIST"],
                "status": "ACTIVE",
            },
        )
        with pytest.raises(Invalid):
            booking.bookable_clinician(TENANT, "s-rec-1")

    def test_a_suspended_clinician_takes_no_appointments(self, seeded, booking, repository):
        repository.update_existing(
            keys.staff_membership(TENANT, CLINICIAN),
            set_values={"status": "SUSPENDED"},
            what="staff account",
        )
        with pytest.raises(Conflict):
            booking.bookable_clinician(TENANT, CLINICIAN)


class TestReads:
    def test_an_unknown_appointment_type_is_not_found(self, seeded, booking):
        with pytest.raises(NotFound):
            booking.appointment_type(TENANT, "at-nope")

    def test_an_unknown_patient_is_not_found(self, seeded, booking):
        with pytest.raises(NotFound):
            booking.patient_profile(TENANT, "pp-nobody")

    def test_a_booked_appointment_can_be_read_back(self, seeded, booking):
        appointment, _event = book(booking)
        found = booking.appointment(TENANT, appointment["appointmentId"])
        assert found["reference"] == appointment["reference"]
