"""A reminder fires a lead time before the appointment, on the clinic's clock.

Verifies FR-REM-01 (a one-time schedule at the start minus the lead time, 24
hours by default), FR-REM-05 (worked out in the region pack's timezone and
stored in UTC) and FR-REM-06 (a booking inside the lead time gets no reminder).
"""

from __future__ import annotations

import datetime as dt

import pytest

from atria.core import reminders
from atria.core.errors import Invalid

DOUALA = reminders.ZoneInfo("Africa/Douala")
PARIS = reminders.ZoneInfo("Europe/Paris")


def utc(*parts: int) -> dt.datetime:
    return dt.datetime(*parts, tzinfo=dt.UTC)


class TestFireAt:
    def test_fr_rem_01_the_default_lead_is_a_day(self):
        assert reminders.fire_at(utc(2026, 3, 4, 8, 0), zone=DOUALA) == utc(2026, 3, 3, 8, 0)

    def test_the_result_is_utc(self):
        fired = reminders.fire_at(utc(2026, 3, 4, 8, 0), zone=DOUALA)
        assert fired.utcoffset() == dt.timedelta(0)

    def test_a_shorter_lead_can_be_given(self):
        fired = reminders.fire_at(utc(2026, 3, 4, 8, 0), zone=DOUALA, lead=dt.timedelta(hours=2))
        assert fired == utc(2026, 3, 4, 6, 0)

    def test_fr_rem_05_the_day_before_is_counted_on_the_clinic_clock(self):
        """Europe/Paris moves its clocks forward overnight into 29 March 2026,
        so that day is 23 hours long. An appointment at 09:00 that morning is
        reminded at 09:00 the day before, which is 23 elapsed hours earlier,
        not 24. Subtracting 24 hours of UTC would remind at 08:00 local,
        an hour early. Cameroon keeps no daylight saving, so there the two agree;
        this is why the order is fixed."""
        start = dt.datetime(2026, 3, 29, 9, 0, tzinfo=PARIS)
        fired = reminders.fire_at(start, zone=PARIS)
        assert fired.astimezone(PARIS) == dt.datetime(2026, 3, 28, 9, 0, tzinfo=PARIS)
        assert fired == utc(2026, 3, 28, 8, 0)
        assert start - fired == dt.timedelta(hours=23)
        naive_utc = start.astimezone(dt.UTC) - dt.timedelta(hours=24)
        assert naive_utc.astimezone(PARIS).hour == 8

    def test_a_start_without_an_offset_is_refused(self):
        naive = dt.datetime(2026, 3, 4, 8, 0)  # noqa: DTZ001  the case under test
        with pytest.raises(Invalid):
            reminders.fire_at(naive, zone=DOUALA)


class TestPlan:
    def test_a_booking_well_ahead_is_scheduled(self):
        decided = reminders.plan(utc(2026, 3, 4, 8, 0), now=utc(2026, 3, 1, 9, 0), zone=DOUALA)
        assert decided.send_now is False
        assert decided.fire_at == utc(2026, 3, 3, 8, 0)

    def test_fr_rem_06_a_booking_inside_the_lead_time_is_confirmed_now(self):
        decided = reminders.plan(utc(2026, 3, 1, 20, 0), now=utc(2026, 3, 1, 9, 0), zone=DOUALA)
        assert decided.send_now is True

    def test_exactly_at_the_lead_time_is_too_late_to_schedule(self):
        """A schedule cannot be created for a time that has already arrived."""
        decided = reminders.plan(utc(2026, 3, 2, 9, 0), now=utc(2026, 3, 1, 9, 0), zone=DOUALA)
        assert decided.send_now is True

    def test_br_08_a_booking_26_hours_ahead_fires_before_the_appointment(self):
        now = utc(2026, 3, 1, 9, 0)
        start = now + dt.timedelta(hours=26)
        decided = reminders.plan(start, now=now, zone=DOUALA)
        assert decided.send_now is False
        assert now < decided.fire_at < start
        assert decided.fire_at == now + dt.timedelta(hours=2)


class TestNames:
    def test_the_schedule_is_named_after_the_appointment(self):
        """So a cancellation can remove it knowing only the appointment."""
        assert reminders.schedule_name("a-0123456789abcdef") == "reminder-a-0123456789abcdef"

    def test_the_same_appointment_always_gets_the_same_name(self):
        """So a retry cannot create a second reminder."""
        assert reminders.schedule_name("a-1") == reminders.schedule_name("a-1")

    @pytest.mark.parametrize("bad", ["a 1", "a/1", "a" * 70, "a#1"])
    def test_an_identifier_that_cannot_name_a_schedule_is_refused(self, bad):
        with pytest.raises(Invalid):
            reminders.schedule_name(bad)

    def test_the_expression_is_a_utc_one_time_schedule(self):
        start = dt.datetime(2026, 3, 3, 9, 0, tzinfo=DOUALA)
        assert reminders.at_expression(start) == "at(2026-03-03T08:00:00)"
