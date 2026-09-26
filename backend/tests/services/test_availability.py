# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""A clinician's hours and time off.

Verifies FR-DIR-03 (working hours per weekday, on the grid, which the free
search then uses), FR-DIR-04 (a block cannot cover a booking), FR-DIR-05 and
FR-STF-10 (leave and marking a clinician unavailable disrupt the visits
inside, and a disrupted visit given a new time is booked again), and who may
do each.

The wiring, the clinician and the booking helper are the cancellation tests'.
The clinic opens 08:00 to 17:00 every day; 2026-03-04 is a Wednesday (weekday
2), and START is 09:00 in Douala.
"""

from __future__ import annotations

import json

import pytest
from test_appointment_cancel import (
    DOUALA,
    START,
    TENANT,
    TYPE_ID,
    body_of,
    book,
    patient_context,
    staff_context,
    wired,
)

from atria.services.booking import appointments as booking_service
from atria.services.directory import availability as availability_service
from atria.services.directory import clinicians as directory

pytestmark = pytest.mark.usefixtures("table")


def clinician_context(clinician_id: str):
    return {
        "personId": "p-clin",
        "tenantId": TENANT,
        "roles": "CLINICIAN",
        "staffId": clinician_id,
        "clinicId": DOUALA,
    }


@pytest.fixture(autouse=True)
def shared_booking(monkeypatch, wired):
    """The availability function reads the same booking data the fixture wired."""
    monkeypatch.setattr(availability_service, "_booking", directory._booking)


def call(method: str, resource: str, clinician_id: str, *, context, body=None, extra=None):
    return availability_service.handler(
        {
            "httpMethod": method,
            "resource": resource,
            "pathParameters": {"id": clinician_id, **(extra or {})},
            "queryStringParameters": None,
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": context},
        },
        None,
    )


def slots(clinician_id: str, date: str) -> list[str]:
    result = directory.handler(
        {
            "httpMethod": "GET",
            "resource": "/clinicians/{id}/slots",
            "pathParameters": {"id": clinician_id},
            "queryStringParameters": {"date": date, "typeId": TYPE_ID},
            "requestContext": {"authorizer": patient_context()},
        },
        None,
    )
    assert result["statusCode"] == 200, result["body"]
    return [s["startAt"] for s in body_of(result)["slots"]]


def appointment(appointment_id: str) -> dict:
    return body_of(
        booking_service.handler(
            {
                "httpMethod": "GET",
                "resource": "/appointments/{id}",
                "pathParameters": {"id": appointment_id},
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
    )


class TestHours:
    def test_a_clinician_sets_their_own_week(self, wired):
        _repo, clinician = wired
        result = call(
            "PUT",
            "/clinicians/{id}/hours",
            clinician,
            context=clinician_context(clinician),
            body={"days": {"2": {"start": "10:00", "end": "12:00"}}},
        )
        assert result["statusCode"] == 200, result["body"]
        read = body_of(
            call("GET", "/clinicians/{id}/availability", clinician, context=staff_context())
        )
        assert read["usesUnitHours"] is False
        assert read["hours"] == {"2": {"start": "10:00", "end": "12:00"}}

    def test_the_free_search_follows_them(self, wired):
        _repo, clinician = wired
        before = slots(clinician, "2026-03-04")
        call(
            "PUT",
            "/clinicians/{id}/hours",
            clinician,
            context=clinician_context(clinician),
            body={"days": {"2": {"start": "10:00", "end": "12:00"}}},
        )
        after = slots(clinician, "2026-03-04")
        assert len(after) < len(before)
        # 10:00 in Douala is 09:00 UTC; the last 40-minute hold must end by 12:00.
        assert after[0] == "2026-03-04T09:00:00Z"
        assert after[-1] == "2026-03-04T10:20:00Z"
        # Thursday was not given, so it is a day off.
        assert slots(clinician, "2026-03-05") == []

    def test_without_hours_of_their_own_the_units_apply(self, wired):
        _repo, clinician = wired
        read = body_of(
            call("GET", "/clinicians/{id}/availability", clinician, context=staff_context())
        )
        assert read["usesUnitHours"] is True
        assert slots(clinician, "2026-03-05")

    def test_hours_sit_on_the_grid(self, wired):
        _repo, clinician = wired
        result = call(
            "PUT",
            "/clinicians/{id}/hours",
            clinician,
            context=clinician_context(clinician),
            body={"days": {"2": {"start": "10:05", "end": "12:00"}}},
        )
        assert result["statusCode"] == 400

    def test_the_front_desk_cannot_change_them(self, wired):
        _repo, clinician = wired
        result = call(
            "PUT",
            "/clinicians/{id}/hours",
            clinician,
            context=staff_context(),
            body={"days": {"2": {"start": "10:00", "end": "12:00"}}},
        )
        assert result["statusCode"] == 403


class TestTimeOff:
    def take(self, clinician, body, *, context=None):
        return call(
            "POST",
            "/clinicians/{id}/time-off",
            clinician,
            context=context or clinician_context(clinician),
            body=body,
        )

    def test_a_block_takes_free_time_out_of_the_search(self, wired):
        _repo, clinician = wired
        result = self.take(
            clinician,
            {
                "kind": "BLOCK",
                "date": "2026-03-04",
                "startTime": "09:00",
                "endTime": "11:00",
                "reason": "Ward round",
            },
        )
        assert result["statusCode"] == 201, result["body"]
        assert not [s for s in slots(clinician, "2026-03-04") if "T08:" in s or "T09:" in s]

    def test_fr_dir_04_a_block_cannot_cover_a_booking(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = self.take(
            clinician,
            {
                "kind": "BLOCK",
                "date": "2026-03-04",
                "startTime": "09:00",
                "endTime": "11:00",
                "reason": "Ward round",
            },
        )
        assert result["statusCode"] == 409
        assert booked["reference"] in body_of(result)["detail"]["references"]
        # Nothing was left behind: the rest of the morning is still offered.
        assert "2026-03-04T09:00:00Z" in slots(clinician, "2026-03-04")

    def test_fr_dir_05_leave_disrupts_the_visits_inside(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = self.take(
            clinician,
            {"kind": "LEAVE", "from": "2026-03-03", "to": "2026-03-05", "reason": "Annual leave"},
        )
        assert result["statusCode"] == 201, result["body"]
        assert [a["appointmentId"] for a in body_of(result)["disrupted"]] == [
            booked["appointmentId"]
        ]
        assert appointment(booked["appointmentId"])["state"] == "DISRUPTED"
        assert slots(clinician, "2026-03-05") == []

    def test_leave_is_whole_days(self, wired):
        _repo, clinician = wired
        result = self.take(
            clinician,
            {
                "kind": "LEAVE",
                "date": "2026-03-04",
                "startTime": "09:00",
                "endTime": "11:00",
                "reason": "x",
            },
        )
        assert result["statusCode"] == 400

    def test_fr_stf_10_the_desk_marks_a_clinician_unavailable(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        result = self.take(
            clinician,
            {
                "kind": "UNAVAILABLE",
                "date": "2026-03-04",
                "startTime": "08:00",
                "endTime": "12:00",
                "reason": "Called away",
            },
            context=staff_context(),
        )
        assert result["statusCode"] == 201, result["body"]
        assert appointment(booked["appointmentId"])["state"] == "DISRUPTED"

    def test_the_desk_cannot_book_leave_for_a_clinician(self, wired):
        _repo, clinician = wired
        result = self.take(
            clinician,
            {"kind": "LEAVE", "date": "2026-03-04", "reason": "x"},
            context=staff_context(),
        )
        assert result["statusCode"] == 403

    def test_a_reason_is_required(self, wired):
        _repo, clinician = wired
        assert self.take(clinician, {"kind": "BLOCK", "date": "2026-03-04"})["statusCode"] == 400

    def test_time_already_past_cannot_be_taken(self, wired):
        _repo, clinician = wired
        result = self.take(clinician, {"kind": "BLOCK", "date": "2026-02-27", "reason": "x"})
        assert result["statusCode"] == 400

    def test_a_disrupted_visit_given_a_new_time_is_booked_again(self, wired):
        _repo, clinician = wired
        booked = book(clinician)
        self.take(clinician, {"kind": "LEAVE", "date": "2026-03-04", "reason": "Unwell"})
        moved = booking_service.handler(
            {
                "httpMethod": "POST",
                "resource": "/appointments/{id}/reschedule",
                "pathParameters": {"id": booked["appointmentId"]},
                "body": json.dumps({"startAt": "2026-03-05T09:00:00Z"}),
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        assert moved["statusCode"] == 200, moved["body"]
        assert body_of(moved)["state"] == "BOOKED"

    def test_given_back_the_time_is_offered_again(self, wired):
        _repo, clinician = wired
        taken = body_of(
            self.take(
                clinician,
                {
                    "kind": "BLOCK",
                    "date": "2026-03-04",
                    "startTime": "09:00",
                    "endTime": "11:00",
                    "reason": "Meeting",
                },
            )
        )
        read = body_of(
            call("GET", "/clinicians/{id}/availability", clinician, context=staff_context())
        )
        assert [t["groupId"] for t in read["timeOff"]] == [taken["groupId"]]
        back = call(
            "DELETE",
            "/clinicians/{id}/time-off/{groupId}",
            clinician,
            context=clinician_context(clinician),
            extra={"groupId": taken["groupId"]},
        )
        assert back["statusCode"] == 200, back["body"]
        assert "2026-03-04T08:00:00Z" in slots(clinician, "2026-03-04")
