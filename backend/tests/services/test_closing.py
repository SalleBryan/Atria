# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""Visits whose day is over are closed, and only then.

The visit is the cancellation tests': 09:00 to 09:30 in Douala on 4 March
(08:00 to 08:30 UTC), so its day ends at 23:00 UTC.
"""

from __future__ import annotations

import datetime as dt

import pytest
from test_appointment_cancel import CLOCK, DOUALA, TENANT, book, staff_context, wired
from test_appointment_visits import act, events

from atria.data import keys
from atria.data.catalogue import clinic_listing
from atria.services.booking import closing

pytestmark = pytest.mark.usefixtures("table")

DURING_THE_DAY = dt.datetime(2026, 3, 4, 12, 0, tzinfo=dt.UTC)
NEXT_DAY = dt.datetime(2026, 3, 5, 0, 30, tzinfo=dt.UTC)


@pytest.fixture
def listed(wired):
    """The unit, listed in the directory, where the job finds it."""
    repository, clinician = wired
    unit = repository.get(keys.clinic(TENANT, DOUALA))
    listing = clinic_listing(TENANT, DOUALA, "Douala")
    repository.put(keys.clinic(TENANT, DOUALA), {**unit, **listing})
    return repository, clinician


def state_of(repository, appointment_id: str) -> str:
    return str(repository.get(keys.appointment(TENANT, appointment_id))["state"])


class TestClosing:
    def test_a_visit_is_left_open_while_its_day_lasts(self, listed):
        repository, clinician = listed
        booked = book(clinician)
        assert closing.close_past(TENANT, DURING_THE_DAY) == {"closed": 0, "failed": 0}
        assert state_of(repository, booked["appointmentId"]) == "BOOKED"

    def test_after_its_day_nobody_came_is_recorded(self, listed):
        repository, clinician = listed
        booked = book(clinician)
        CLOCK["now"] = NEXT_DAY
        assert closing.close_past(TENANT, NEXT_DAY) == {"closed": 1, "failed": 0}
        assert state_of(repository, booked["appointmentId"]) == "NO_SHOW"
        last = max(events(repository, booked["appointmentId"]), key=lambda e: e["occurredAt"])
        assert (last["kind"], last["actorRole"]) == ("NO_SHOW", "SYSTEM")
        assert "automatically" in last["reason"]
        ledger = repository.get(keys.fee_ledger_entry(TENANT, booked["appointmentId"]))
        assert ledger["outcome"] == "NO_SHOW"

    def test_a_second_run_closes_nothing_more(self, listed):
        _repository, clinician = listed
        book(clinician)
        CLOCK["now"] = NEXT_DAY
        closing.close_past(TENANT, NEXT_DAY)
        assert closing.close_past(TENANT, NEXT_DAY) == {"closed": 0, "failed": 0}

    def test_a_patient_who_arrived_is_left_for_the_clinician(self, listed):
        repository, clinician = listed
        booked = book(clinician)
        CLOCK["now"] = DURING_THE_DAY
        act(booked["appointmentId"], "arrive", context=staff_context())
        CLOCK["now"] = NEXT_DAY
        closing.close_past(TENANT, NEXT_DAY)
        assert state_of(repository, booked["appointmentId"]) == "ARRIVED"

    def test_a_disrupted_visit_with_no_new_time_is_the_hospitals_cancellation(self, listed):
        repository, clinician = listed
        booked = book(clinician)
        key = keys.appointment(TENANT, booked["appointmentId"])
        repository.put(key, {**repository.get(key), "state": "DISRUPTED"})
        CLOCK["now"] = NEXT_DAY
        closing.close_past(TENANT, NEXT_DAY)
        closed = repository.get(key)
        assert (closed["state"], closed["entitlement"]) == ("CLINIC_CANCELLED", "FULL")
