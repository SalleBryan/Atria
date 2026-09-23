"""A start is free only when the whole appointment fits.

Verifies FR-DIR-02: every grid unit of the type's duration and buffer must be
inside working hours, not locked, not blocked, and at least the type's minimum
notice from now.

Times in a clinic are local, in the region pack's timezone, while locks are
instants in UTC. Africa/Douala is UTC+1 with no daylight saving, so the offset
is asserted explicitly here: a fixed offset would pass everything else and
still be the wrong thing to have written.
"""

from __future__ import annotations

import datetime as dt

import pytest

from atria.core import schedule
from atria.core.errors import Invalid

DAY = dt.date(2026, 3, 4)  # A Wednesday, weekday 2.
DOUALA = schedule.ZoneInfo("Africa/Douala")

# 08:00 to 12:00 local, which is 07:00 to 11:00 UTC.
HOURS = {"2": {"start": "08:00", "end": "12:00"}}


def window() -> schedule.Window:
    found = schedule.opening_window(HOURS, DAY, zone=DOUALA)
    assert found is not None
    return found


class TestOpeningWindow:
    def test_local_hours_become_utc_instants(self):
        found = window()
        assert found.opens_at == dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
        assert found.closes_at == dt.datetime(2026, 3, 4, 11, 0, tzinfo=dt.UTC)

    def test_a_day_with_no_hours_is_closed(self):
        """Monday is not in the table, so the clinic is shut."""
        assert schedule.opening_window(HOURS, dt.date(2026, 3, 2), zone=DOUALA) is None

    def test_a_clinic_with_no_hours_at_all_is_closed(self):
        """Phase 1 seeds the hours. Inventing a default would offer starts the
        clinic never agreed to."""
        assert schedule.opening_window(None, DAY, zone=DOUALA) is None
        assert schedule.opening_window({}, DAY, zone=DOUALA) is None

    def test_an_integer_weekday_key_works_too(self):
        assert schedule.opening_window({2: {"start": "08:00", "end": "12:00"}}, DAY, zone=DOUALA)

    def test_closing_before_opening_is_refused(self):
        with pytest.raises(Invalid):
            schedule.opening_window({"2": {"start": "12:00", "end": "08:00"}}, DAY, zone=DOUALA)

    def test_a_malformed_time_is_refused(self):
        with pytest.raises(Invalid):
            schedule.opening_window({"2": {"start": "morning", "end": "12:00"}}, DAY, zone=DOUALA)


class TestCandidates:
    def test_the_last_start_leaves_room_for_the_whole_appointment(self):
        starts = schedule.candidate_starts(window(), held_units=4, minutes=10)
        assert starts[0] == dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
        # 11:00 minus 40 minutes of occupancy.
        assert starts[-1] == dt.datetime(2026, 3, 4, 10, 20, tzinfo=dt.UTC)

    def test_a_longer_appointment_has_fewer_starts(self):
        few = schedule.candidate_starts(window(), held_units=12, minutes=10)
        many = schedule.candidate_starts(window(), held_units=2, minutes=10)
        assert len(few) < len(many)


class TestFreeStarts:
    def free(self, **overrides):
        settings = {
            "window": window(),
            "locked_units": set(),
            "blocked": [],
            "duration_units": 3,
            "buffer_units": 1,
            "minutes": 10,
            "now": dt.datetime(2026, 3, 4, 6, 0, tzinfo=dt.UTC),
            "min_notice_minutes": 0,
            "max_advance_days": 0,
        }
        settings.update(overrides)
        return schedule.free_starts(**settings)

    def test_an_empty_day_offers_every_start(self):
        found = self.free()
        assert found[0].start_at == dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
        assert len(found) == 21

    def test_the_end_offered_is_the_duration_not_the_buffer(self):
        """What the patient is told is 30 minutes, though 40 are held."""
        first = self.free()[0]
        assert first.end_at == dt.datetime(2026, 3, 4, 7, 30, tzinfo=dt.UTC)
        assert first.held_until == dt.datetime(2026, 3, 4, 7, 40, tzinfo=dt.UTC)

    def test_a_closed_day_offers_nothing(self):
        assert self.free(window=None) == []

    def test_a_locked_unit_removes_every_start_that_needs_it(self):
        """One taken unit rules out the four starts whose occupancy covers it."""
        locked = {"2026-03-04T08:00:00Z"}
        offered = {schedule.rules.instant(o.start_at) for o in self.free(locked_units=locked)}
        assert "2026-03-04T08:00:00Z" not in offered
        # A start 30 minutes earlier still holds 08:00 through its buffer.
        assert "2026-03-04T07:30:00Z" not in offered
        assert "2026-03-04T07:10:00Z" in offered

    def test_a_blocked_window_removes_the_starts_it_covers(self):
        blocked = [
            schedule.Window(
                opens_at=dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC),
                closes_at=dt.datetime(2026, 3, 4, 9, 0, tzinfo=dt.UTC),
            )
        ]
        offered = {schedule.rules.instant(o.start_at) for o in self.free(blocked=blocked)}
        assert "2026-03-04T08:30:00Z" not in offered
        assert "2026-03-04T09:00:00Z" in offered

    def test_the_minimum_notice_is_applied(self):
        found = self.free(now=dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC), min_notice_minutes=60)
        assert found[0].start_at == dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC)

    def test_a_day_beyond_the_booking_window_offers_nothing(self):
        assert self.free(now=dt.datetime(2026, 1, 1, 6, 0, tzinfo=dt.UTC), max_advance_days=7) == []

    def test_a_past_day_offers_nothing(self):
        assert self.free(now=dt.datetime(2026, 3, 5, 6, 0, tzinfo=dt.UTC)) == []


class TestBlockedWindows:
    def test_an_unavailable_span_is_blocked(self):
        found = schedule.blocked_windows(
            [
                {
                    "kind": "UNAVAILABLE",
                    "exceptionDate": "2026-03-04",
                    "startTime": "09:00",
                    "endTime": "10:00",
                }
            ],
            DAY,
            zone=DOUALA,
        )
        assert found[0].opens_at == dt.datetime(2026, 3, 4, 8, 0, tzinfo=dt.UTC)

    def test_an_exception_with_no_times_blocks_the_whole_day(self):
        found = schedule.blocked_windows(
            [{"kind": "UNAVAILABLE", "exceptionDate": "2026-03-04"}], DAY, zone=DOUALA
        )
        assert len(found) == 1
        assert found[0].closes_at - found[0].opens_at == dt.timedelta(days=1)

    def test_an_exception_on_another_day_is_ignored(self):
        assert (
            schedule.blocked_windows(
                [{"kind": "UNAVAILABLE", "exceptionDate": "2026-03-05"}], DAY, zone=DOUALA
            )
            == []
        )

    def test_extra_hours_are_not_read_in_phase_one(self):
        """An EXTRA exception adds hours, which is the Phase 2 model."""
        assert (
            schedule.blocked_windows(
                [{"kind": "EXTRA", "exceptionDate": "2026-03-04"}], DAY, zone=DOUALA
            )
            == []
        )


class TestTimezone:
    def test_the_region_pack_chooses_the_zone(self):
        assert schedule.timezone_for({"timezone": "Africa/Douala"}) == DOUALA

    def test_the_default_is_the_cameroon_zone(self):
        assert schedule.timezone_for(None) == DOUALA
        assert schedule.timezone_for({}) == DOUALA

    def test_an_unknown_zone_is_refused(self):
        with pytest.raises(Invalid):
            schedule.timezone_for({"timezone": "Mars/Olympus"})


class TestParseDate:
    def test_a_date_is_read(self):
        assert schedule.parse_date("2026-03-04") == DAY

    @pytest.mark.parametrize("value", ["", None, "next tuesday", "04/03/2026", 20260304])
    def test_anything_else_is_refused(self, value):
        with pytest.raises(Invalid):
            schedule.parse_date(value)
