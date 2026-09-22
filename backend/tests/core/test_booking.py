"""A booking request has to name a real time before anything is locked.

Verifies FR-BKG-01 (the specialist path: a clinician, a date and a free start),
FR-BKG-02 (a booking of N grid units occupies N consecutive units) and
FR-BKG-05 (each type sets its own minimum notice and booking window).

Guard SERVER_ASSIGNED_ORDER is verified here too: a field the server derives is
rejected rather than being quietly dropped.
"""

from __future__ import annotations

import datetime as dt

import pytest

from atria.core import booking
from atria.core.errors import Invalid

NOW = dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
START = "2026-03-04T08:00:00Z"

REQUEST = {
    "patientProfileId": "pp-1",
    "appointmentTypeId": "at-spec-first",
    "clinicianProfileId": "s-clin-1",
    "startAt": START,
}

TYPE = {
    "appointmentTypeId": "at-spec-first",
    "serviceLine": "SPECIALIST",
    "durationUnits": 3,
    "bufferUnits": 1,
    "bookableBy": "BOTH",
    "minNoticeMinutes": 30,
    "maxAdvanceDays": 60,
    "active": True,
}


class TestValidate:
    def test_a_staff_request_names_the_patient(self):
        request = booking.validate(REQUEST, by_patient=False, own_patient_profile_id=None)
        assert request.patient_profile_id == "pp-1"
        assert request.clinician_profile_id == "s-clin-1"
        assert request.start_at == dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC)

    def test_a_patient_books_for_themselves_whatever_the_body_says(self):
        """The body cannot aim a patient's booking at somebody else."""
        body = {**REQUEST, "patientProfileId": "pp-somebody-else"}
        request = booking.validate(body, by_patient=True, own_patient_profile_id="pp-mine")
        assert request.patient_profile_id == "pp-mine"

    def test_a_patient_without_a_profile_cannot_book(self):
        with pytest.raises(Invalid):
            booking.validate(REQUEST, by_patient=True, own_patient_profile_id=None)

    @pytest.mark.parametrize("field", booking.DERIVED_FIELDS)
    def test_a_server_derived_field_is_rejected_not_ignored(self, field):
        """Guard SERVER_ASSIGNED_ORDER."""
        body = {**REQUEST, field: "anything"}
        with pytest.raises(Invalid) as raised:
            booking.validate(body, by_patient=False, own_patient_profile_id=None)
        assert field in raised.value.detail["fields"]

    def test_the_clinic_cannot_be_chosen_by_the_caller(self):
        """It comes from the clinician's membership, so naming it is refused.

        Ignoring it would let a caller believe it had placed the booking in a
        clinic of its choosing.
        """
        body = {**REQUEST, "clinicId": "c-somewhere-else"}
        with pytest.raises(Invalid) as raised:
            booking.validate(body, by_patient=False, own_patient_profile_id=None)
        assert "clinicId" in raised.value.detail["fields"]

    @pytest.mark.parametrize("missing", ["appointmentTypeId", "clinicianProfileId"])
    def test_a_missing_required_field_is_refused(self, missing):
        body = {k: v for k, v in REQUEST.items() if k != missing}
        with pytest.raises(Invalid):
            booking.validate(body, by_patient=False, own_patient_profile_id=None)

    def test_a_start_without_an_offset_is_refused(self):
        """A local time read as UTC would silently book the wrong hour."""
        body = {**REQUEST, "startAt": "2026-03-04T08:00:00"}
        with pytest.raises(Invalid):
            booking.validate(body, by_patient=False, own_patient_profile_id=None)

    def test_an_unparseable_start_is_refused(self):
        body = {**REQUEST, "startAt": "next tuesday"}
        with pytest.raises(Invalid):
            booking.validate(body, by_patient=False, own_patient_profile_id=None)

    def test_an_offset_start_is_normalised_to_utc(self):
        body = {**REQUEST, "startAt": "2026-03-04T09:00:00+01:00"}
        request = booking.validate(body, by_patient=False, own_patient_profile_id=None)
        assert request.start_at == dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC)

    def test_an_unknown_channel_is_refused(self):
        body = {**REQUEST, "channel": "CARRIER_PIGEON"}
        with pytest.raises(Invalid):
            booking.validate(body, by_patient=False, own_patient_profile_id=None)

    def test_the_channel_defaults_to_online(self):
        request = booking.validate(REQUEST, by_patient=False, own_patient_profile_id=None)
        assert request.channel == "ONLINE"


class TestOccupancy:
    def test_fr_bkg_02_n_units_are_consecutive(self):
        held = booking.occupancy(
            dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC),
            duration_units=3,
            buffer_units=0,
            minutes=10,
        )
        assert held.units == (
            "2026-03-04T08:00:00Z",
            "2026-03-04T08:10:00Z",
            "2026-03-04T08:20:00Z",
        )

    def test_the_buffer_is_held_but_is_not_part_of_the_appointment(self):
        """endAt is what the patient is told; the buffer only blocks the next booking."""
        held = booking.occupancy(
            dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC),
            duration_units=3,
            buffer_units=2,
            minutes=10,
        )
        assert held.end_at == dt.datetime(2026, 3, 4, 8, 30, tzinfo=dt.UTC)
        assert held.held_until == dt.datetime(2026, 3, 4, 8, 50, tzinfo=dt.UTC)
        assert len(held.units) == 5

    def test_a_type_with_no_duration_cannot_hold_a_slot(self):
        """A null duration is the queued general line, which has no start to lock."""
        with pytest.raises(Invalid):
            booking.occupancy(
                dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC),
                duration_units=0,
                buffer_units=0,
                minutes=10,
            )

    def test_a_duration_past_the_transaction_limit_is_refused(self):
        with pytest.raises(Invalid) as raised:
            booking.occupancy(
                dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC),
                duration_units=booking.MAX_LOCKED_UNITS + 1,
                buffer_units=0,
                minutes=10,
            )
        assert raised.value.detail["maximum"] == booking.MAX_LOCKED_UNITS

    def test_a_longer_grid_unit_holds_fewer_items_for_the_same_hour(self):
        held = booking.occupancy(
            dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC),
            duration_units=2,
            buffer_units=0,
            minutes=30,
        )
        assert held.end_at == dt.datetime(2026, 3, 4, 9, 0, tzinfo=dt.UTC)
        assert len(held.units) == 2


class TestGrid:
    def test_a_start_on_a_boundary_is_accepted(self):
        booking.require_on_grid(dt.datetime(2026, 3, 4, 8, 20, tzinfo=dt.UTC), minutes=10)

    @pytest.mark.parametrize(("minute", "second"), [(5, 0), (20, 30)])
    def test_a_start_off_the_boundary_is_refused(self, minute, second):
        """Half occupying two units would leave a bookable gap nobody can use."""
        with pytest.raises(Invalid):
            booking.require_on_grid(
                dt.datetime(2026, 3, 4, 8, minute, second, tzinfo=dt.UTC), minutes=10
            )

    def test_the_tenants_grid_unit_is_used(self):
        assert booking.grid_unit_minutes({"gridUnitMinutes": 15}) == 15

    def test_the_grid_unit_defaults_to_ten(self):
        assert booking.grid_unit_minutes({}) == booking.DEFAULT_GRID_UNIT_MINUTES

    def test_a_grid_unit_that_does_not_divide_an_hour_is_refused(self):
        """Unit boundaries would drift across the day and locks would not line up."""
        with pytest.raises(Invalid):
            booking.grid_unit_minutes({"gridUnitMinutes": 7})


class TestBookable:
    def start(self, hours: int = 1) -> dt.datetime:
        return NOW + dt.timedelta(hours=hours)

    def test_a_type_inside_its_window_is_bookable(self):
        booking.require_bookable(TYPE, by_patient=True, now=NOW, start_at=self.start())

    def test_an_inactive_type_is_refused(self):
        with pytest.raises(Invalid):
            booking.require_bookable(
                {**TYPE, "active": False}, by_patient=True, now=NOW, start_at=self.start()
            )

    def test_fr_bkg_05_a_start_inside_the_notice_period_is_refused(self):
        with pytest.raises(Invalid) as raised:
            booking.require_bookable(
                TYPE, by_patient=True, now=NOW, start_at=NOW + dt.timedelta(minutes=10)
            )
        assert raised.value.detail["minNoticeMinutes"] == 30

    def test_fr_bkg_05_a_start_beyond_the_booking_window_is_refused(self):
        with pytest.raises(Invalid) as raised:
            booking.require_bookable(
                TYPE, by_patient=True, now=NOW, start_at=NOW + dt.timedelta(days=61)
            )
        assert raised.value.detail["maxAdvanceDays"] == 60

    def test_a_staff_only_type_cannot_be_self_booked(self):
        """ADR 0005: a procedure is sized and placed by staff."""
        with pytest.raises(Invalid):
            booking.require_bookable(
                {**TYPE, "bookableBy": "STAFF"},
                by_patient=True,
                now=NOW,
                start_at=self.start(),
            )

    def test_a_staff_only_type_is_bookable_by_staff(self):
        booking.require_bookable(
            {**TYPE, "bookableBy": "STAFF"}, by_patient=False, now=NOW, start_at=self.start()
        )

    def test_a_patient_only_type_is_not_bookable_by_staff(self):
        with pytest.raises(Invalid):
            booking.require_bookable(
                {**TYPE, "bookableBy": "PATIENT"},
                by_patient=False,
                now=NOW,
                start_at=self.start(),
            )
