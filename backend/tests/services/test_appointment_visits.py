# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""After booking: moving, confirming, arriving, consulting and no-shows.

Verifies FR-VIS-05 (staff give a reason), FR-VIS-07 (a reschedule locks the
new units and frees the old in one step, keeping the reference), FR-VIS-08
(each move follows the lifecycle), FR-STF-04 (arrival is recorded against the
staff account) and FR-STF-05 (a no-show only after the grace).

The wiring, the clinician and the booking helper are the cancellation tests'.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from test_appointment_cancel import (  # the same tenant, clinician and clock
    CLOCK,
    DOUALA,
    START,
    TENANT,
    body_of,
    book,
    cancel,
    patient_context,
    staff_context,
    wired,
)

from atria.core import booking as rules
from atria.data import keys
from atria.services.booking import appointments as service

pytestmark = pytest.mark.usefixtures("table")

LATER = "2026-03-05T09:00:00Z"


def act(appointment_id: str, action: str, *, context=None, body=None):
    return service.handler(
        {
            "httpMethod": "POST",
            "resource": f"/appointments/{{id}}/{action}",
            "pathParameters": {"id": appointment_id},
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": context or patient_context()},
        },
        None,
    )


def clinician_context(clinician_id: str, **extra):
    base = {
        "personId": "p-clin",
        "tenantId": TENANT,
        "roles": "CLINICIAN",
        "staffId": clinician_id,
        "clinicId": DOUALA,
    }
    base.update(extra)
    return base


def units(start: str) -> tuple[str, ...]:
    return rules.occupancy(
        rules.parse_instant(start, name="startAt"), duration_units=3, buffer_units=1, minutes=10
    ).units


def events(repository, appointment_id: str) -> list[dict]:
    return repository.query_partition(
        keys.appointment(TENANT, appointment_id).pk, sk_prefix="EVENT#"
    )


class TestReschedule:
    def test_a_patient_moves_their_own_visit_and_keeps_the_reference(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = act(booked["appointmentId"], "reschedule", body={"startAt": LATER})
        assert result["statusCode"] == 200, result["body"]
        moved = body_of(result)
        assert moved["state"] == "RESCHEDULED"
        assert moved["startAt"] == LATER
        assert moved["reference"] == booked["reference"]

    def test_the_new_time_is_held_and_the_old_time_is_free(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        act(booked["appointmentId"], "reschedule", body={"startAt": LATER})
        assert all(repository.get(keys.slot_lock(TENANT, clinician, u)) for u in units(LATER))
        assert not any(repository.get(keys.slot_lock(TENANT, clinician, u)) for u in units(START))
        # And the old time can be booked by someone else.
        assert book(clinician)["startAt"] == START

    def test_a_move_that_overlaps_its_own_time_keeps_the_shared_units(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        ten_later = "2026-03-04T08:10:00Z"
        result = act(booked["appointmentId"], "reschedule", body={"startAt": ten_later})
        assert result["statusCode"] == 200, result["body"]
        assert all(repository.get(keys.slot_lock(TENANT, clinician, u)) for u in units(ten_later))
        assert repository.get(keys.slot_lock(TENANT, clinician, START)) is None

    def test_a_taken_time_is_a_409_and_nothing_moves(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        book(clinician, start=LATER)
        result = act(booked["appointmentId"], "reschedule", body={"startAt": LATER})
        assert result["statusCode"] == 409
        assert all(repository.get(keys.slot_lock(TENANT, clinician, u)) for u in units(START))

    def test_it_can_be_moved_twice(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        act(booked["appointmentId"], "reschedule", body={"startAt": LATER})
        again = act(booked["appointmentId"], "reschedule", body={"startAt": "2026-03-06T10:00:00Z"})
        assert again["statusCode"] == 200, again["body"]
        assert body_of(again)["startAt"] == "2026-03-06T10:00:00Z"

    def test_the_event_links_the_new_time_to_the_old(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        act(booked["appointmentId"], "reschedule", body={"startAt": LATER})
        moved = [
            e for e in events(repository, booked["appointmentId"]) if e["kind"] == "RESCHEDULED"
        ]
        assert moved[0]["previousStartAt"] == START
        assert moved[0]["rescheduledBy"] == "PATIENT"

    def test_staff_say_why_and_whose_move_it_is(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        no_reason = act(
            booked["appointmentId"],
            "reschedule",
            context=staff_context(),
            body={"startAt": LATER, "rescheduledBy": "CLINIC"},
        )
        assert no_reason["statusCode"] == 400
        result = act(
            booked["appointmentId"],
            "reschedule",
            context=staff_context(),
            body={"startAt": LATER, "rescheduledBy": "CLINIC", "reason": "theatre overran"},
        )
        assert result["statusCode"] == 200, result["body"]
        moved = [
            e for e in events(repository, booked["appointmentId"]) if e["kind"] == "RESCHEDULED"
        ]
        assert moved[0]["entitlement"] == "NONE"
        assert moved[0]["reason"] == "theatre overran"

    def test_a_patient_cannot_move_into_the_past_or_inside_the_notice(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        past = act(booked["appointmentId"], "reschedule", body={"startAt": "2026-02-28T08:00:00Z"})
        assert past["statusCode"] == 400
        soon = act(booked["appointmentId"], "reschedule", body={"startAt": "2026-03-01T09:10:00Z"})
        assert soon["statusCode"] == 400

    def test_a_patient_cannot_change_the_clinician(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = act(
            booked["appointmentId"],
            "reschedule",
            body={"startAt": LATER, "clinicianProfileId": "s-somebody-else"},
        )
        assert result["statusCode"] == 400

    def test_a_cancelled_visit_cannot_be_moved(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        cancel(booked["appointmentId"])
        result = act(booked["appointmentId"], "reschedule", body={"startAt": LATER})
        assert result["statusCode"] == 409

    def test_another_patient_cannot_move_it(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = act(
            booked["appointmentId"],
            "reschedule",
            context=patient_context(patientProfileId="pp-somebody-else"),
            body={"startAt": LATER},
        )
        assert result["statusCode"] == 403


class TestTheVisit:
    def test_the_patient_confirms_and_staff_cannot_do_it_for_them(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        assert act(booked["appointmentId"], "confirm", context=staff_context())["statusCode"] == 403
        result = act(booked["appointmentId"], "confirm")
        assert body_of(result)["state"] == "CONFIRMED"

    def test_arrival_then_consultation_then_completed(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        appointment_id = booked["appointmentId"]
        arrived = act(appointment_id, "arrive", context=staff_context())
        assert body_of(arrived)["state"] == "ARRIVED"
        started = act(appointment_id, "start", context=clinician_context(clinician))
        assert body_of(started)["state"] == "IN_CONSULTATION"
        done = act(appointment_id, "complete", context=clinician_context(clinician))
        assert body_of(done)["state"] == "COMPLETED"

    def test_arrival_is_recorded_against_the_staff_account(self, wired):
        repository, clinician = wired
        booked = book(clinician)
        act(booked["appointmentId"], "arrive", context=staff_context())
        arrived = [e for e in events(repository, booked["appointmentId"]) if e["kind"] == "ARRIVED"]
        assert arrived[0]["actorPersonId"] == "p-rec"
        assert arrived[0]["actorRole"] == "RECEPTIONIST"

    def test_a_patient_cannot_record_their_own_arrival(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        assert act(booked["appointmentId"], "arrive")["statusCode"] == 403

    def test_a_clinician_can_record_arrival_at_their_clinic(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        response = act(booked["appointmentId"], "arrive", context=clinician_context(clinician))
        assert response["statusCode"] == 200
        assert body_of(response)["state"] == "ARRIVED"

    def test_the_desk_does_not_open_a_consultation(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        act(booked["appointmentId"], "arrive", context=staff_context())
        assert act(booked["appointmentId"], "start", context=staff_context())["statusCode"] == 403

    def test_a_consultation_cannot_start_before_arrival(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = act(booked["appointmentId"], "start", context=clinician_context(clinician))
        assert result["statusCode"] == 409

    def test_two_arrivals_at_once_record_one(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        act(booked["appointmentId"], "arrive", context=staff_context())
        again = act(booked["appointmentId"], "arrive", context=staff_context())
        assert again["statusCode"] == 409


class TestNoShow:
    def test_not_before_thirty_minutes_after_the_end(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        # The visit ends 08:30; the grace runs to 09:00.
        CLOCK["now"] = dt.datetime(2026, 3, 4, 8, 50, tzinfo=dt.UTC)
        early = act(booked["appointmentId"], "no-show", context=staff_context())
        assert early["statusCode"] == 400
        CLOCK["now"] = dt.datetime(2026, 3, 4, 9, 0, tzinfo=dt.UTC)
        result = act(booked["appointmentId"], "no-show", context=staff_context())
        assert body_of(result)["state"] == "NO_SHOW"

    def test_a_patient_who_arrived_is_not_a_no_show(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        act(booked["appointmentId"], "arrive", context=staff_context())
        CLOCK["now"] = dt.datetime(2026, 3, 4, 12, 0, tzinfo=dt.UTC)
        result = act(booked["appointmentId"], "no-show", context=staff_context())
        assert result["statusCode"] == 400

    def test_proposed_only_for_scheduled_visits_past_the_grace(self):
        visit = {"state": "BOOKED", "endAt": "2026-03-04T08:30:00Z"}
        at = dt.datetime(2026, 3, 4, 9, 0, tzinfo=dt.UTC)
        assert rules.no_show_due(visit, now=at)
        assert not rules.no_show_due(visit, now=at - dt.timedelta(minutes=1))
        assert not rules.no_show_due({**visit, "state": "ARRIVED"}, now=at)


class TestTheDayList:
    def day(self):
        from atria.services.directory import clinicians as directory

        return body_of(
            directory.handler(
                {
                    "httpMethod": "GET",
                    "resource": "/clinics/{id}/day",
                    "pathParameters": {"id": DOUALA},
                    "queryStringParameters": {"date": "2026-03-04"},
                    "requestContext": {"authorizer": staff_context()},
                },
                None,
            )
        )

    def test_the_desk_is_asked_about_a_visit_past_its_grace(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 8, 59, tzinfo=dt.UTC)
        assert self.day()["noShowDue"] == []
        CLOCK["now"] = dt.datetime(2026, 3, 4, 9, 0, tzinfo=dt.UTC)
        assert self.day()["noShowDue"] == [booked["appointmentId"]]
