"""What a patient may be told about their place in the queue (core/queue.py::outlook)."""

import datetime as dt

from atria.core import queue

NOW = dt.datetime(2026, 3, 4, 7, 3, 20, tzinfo=dt.UTC)


def place(n, state="BOOKED", **extra):
    return {"appointmentId": f"a{n}", "position": n, "state": state, **extra}


def test_ahead_counts_those_waiting_or_here_with_an_earlier_place():
    tickets = [place(1, "ARRIVED"), place(2), place(3, "COMPLETED"), place(4), place(5)]
    found = queue.outlook(tickets, tickets[3], NOW, per_hour=4.0)
    assert found["ahead"] == 2


def test_the_next_patient_is_the_one_here_with_nobody_ahead():
    tickets = [place(1, "COMPLETED"), place(2, "ARRIVED")]
    assert queue.outlook(tickets, tickets[1], NOW, per_hour=4.0)["next"] is True
    tickets = [place(1, "ARRIVED"), place(2, "ARRIVED")]
    assert queue.outlook(tickets, tickets[1], NOW, per_hour=4.0)["next"] is False


def test_more_doctors_shorten_the_wait():
    tickets = [place(n) for n in range(1, 7)]
    one = queue.outlook(tickets, tickets[5], NOW, per_hour=4.0, clinicians=1)
    three = queue.outlook(tickets, tickets[5], NOW, per_hour=4.0, clinicians=3)
    assert three["expectedStartAt"] < one["expectedStartAt"]


def test_a_busy_doctor_adds_half_a_consultation():
    free = [place(1)]
    busy = [place(1), place(2, "IN_CONSULTATION")]
    a = queue.outlook(free, free[0], NOW, per_hour=4.0)
    b = queue.outlook(busy, busy[0], NOW, per_hour=4.0)
    assert b["expectedStartAt"] > a["expectedStartAt"]


def test_the_time_is_never_before_the_window_opens():
    mine = place(1, arrivalWindowStart="2026-03-04T08:00:00Z")
    found = queue.outlook([mine], mine, NOW, per_hour=4.0)
    assert found["expectedStartAt"] >= "2026-03-04T08:00:00"
