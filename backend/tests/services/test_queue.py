# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""Sessions, the general queue and procedure requests.

Verifies FR-BKG-09 (three lines; a general consultation is queued), FR-BKG-10
(a manager publishes a session; capacity is derived, never typed, and learns
from measured throughput), FR-BKG-11 (the server assigns the position; the
ticket shows Nth of M and an arrival window; no doctor is named), FR-BKG-13
(walk-ins join the same queue; a doctor is assigned when called; planned
against actual), FR-BKG-14 and FR-STF-15 (a request holds no time; staff size,
place or decline it) and FR-STF-11 (a client-supplied position is refused).

The wiring is the cancellation tests'. 2026-03-04 is a Wednesday; NOW is
10:00 in Douala on 2026-03-01.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from test_appointment_cancel import (
    CLOCK,
    DOUALA,
    NOW,
    PATIENT,
    TENANT,
    body_of,
    patient_context,
    staff_context,
    wired,
)

from atria.data import keys
from atria.data.catalogue import appointment_type_listing
from atria.services.booking import appointments as service
from atria.services.booking import queue as queue_service
from atria.services.notify import outbox

pytestmark = pytest.mark.usefixtures("table")

MANAGER = staff_context(personId="p-mgr", roles="CLINIC_MANAGER", staffId="s-mgr")
DAY = "2026-03-04"


@pytest.fixture
def opd(wired, repository):
    """A general consultation type at the unit, a requestable procedure, a second patient."""
    queue_service.use(None)
    for type_id, fields in (
        (
            "at-gen",
            {
                "name": "General consultation",
                "serviceLine": "GENERAL",
                "durationUnits": None,
                "bookableBy": "BOTH",
            },
        ),
        (
            "at-minor",
            {
                "name": "Minor procedure",
                "serviceLine": "PROCEDURE",
                "durationUnits": 6,
                "bufferUnits": 2,
                "bookableBy": "STAFF",
                "patientRequestable": True,
            },
        ),
    ):
        repository.put(
            keys.appointment_type(TENANT, type_id),
            {
                "type": "APPOINTMENT_TYPE",
                "appointmentTypeId": type_id,
                "tenantId": TENANT,
                "active": True,
                "cancellationWindowMinutes": 60,
                **fields,
                **appointment_type_listing(TENANT, type_id, str(fields["name"])),
            },
        )
    repository.put(
        keys.patient_profile(TENANT, "pp-2"),
        {"type": "PATIENT_PROFILE", "patientProfileId": "pp-2", "tenantId": TENANT},
    )
    yield wired
    queue_service.use(None)


def call(method, resource, *, context, body=None, path=None, query=None):
    return service.handler(
        {
            "httpMethod": method,
            "resource": resource,
            "pathParameters": path,
            "queryStringParameters": query,
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": context},
        },
        None,
    )


def publish(rostered=2, start="08:00", end="12:00", context=MANAGER):
    return call(
        "POST",
        "/clinics/{id}/sessions",
        context=context,
        path={"id": DOUALA},
        body={"date": DAY, "startTime": start, "endTime": end, "rosteredClinicianCount": rostered},
    )


def ticket(session_id, context=None, **body):
    return call(
        "POST",
        "/sessions/{id}/tickets",
        context=context or patient_context(),
        path={"id": session_id},
        body=body or None,
    )


class TestSessions:
    def test_fr_bkg_10_capacity_is_derived_from_doctors_and_pace(self, opd):
        made = body_of(publish())
        # 4 hours, 2 doctors, 4 patients an hour each before anything is measured.
        assert (made["capacity"], made["remaining"], made["partOfDay"]) == (32, 32, "MORNING")

    def test_capacity_is_never_typed(self, opd):
        result = call(
            "POST",
            "/clinics/{id}/sessions",
            context=MANAGER,
            path={"id": DOUALA},
            body={
                "date": DAY,
                "startTime": "08:00",
                "endTime": "12:00",
                "rosteredClinicianCount": 2,
                "capacity": 99,
            },
        )
        assert result["statusCode"] == 400

    def test_the_desk_does_not_publish(self, opd):
        assert publish(context=staff_context())["statusCode"] == 403

    def test_a_session_over_today_takes_no_one(self, opd):
        # NOW is 10:00 on 2026-03-01: a 07:00 to 09:00 session that day is over.
        made = call(
            "POST",
            "/clinics/{id}/sessions",
            context=MANAGER,
            path={"id": DOUALA},
            body={
                "date": "2026-03-01",
                "startTime": "07:00",
                "endTime": "09:00",
                "rosteredClinicianCount": 1,
            },
        )
        assert made["statusCode"] == 201, made
        session_id = body_of(made)["sessionId"]
        listed = body_of(
            call(
                "GET",
                "/clinics/{id}/sessions",
                context=patient_context(),
                path={"id": DOUALA},
                query={"from": "2026-03-01", "to": "2026-03-01"},
            )
        )
        assert listed["sessions"] == []
        assert ticket(session_id)["statusCode"] == 409

    def test_sessions_cannot_overlap(self, opd):
        publish()
        assert publish(start="11:00", end="14:00")["statusCode"] == 409

    def test_a_patient_sees_the_units_sessions(self, opd):
        publish()
        found = body_of(
            call("GET", "/clinics/{id}/sessions", context=patient_context(), path={"id": DOUALA})
        )
        assert [s["sessionDate"] for s in found["sessions"]] == [DAY]


class TestTickets:
    def test_fr_bkg_11_positions_come_from_the_server(self, opd):
        session = body_of(publish())
        first = body_of(ticket(session["sessionId"]))
        second = body_of(
            ticket(
                session["sessionId"],
                context=staff_context(),
                patientProfileId="pp-2",
                channel="WALK_IN",
            )
        )
        assert (first["position"], second["position"], second["of"]) == (1, 2, 2)
        assert first["clinicianProfileId"] is None
        # 08:00 in Douala is 07:00 UTC; the window opens a little before the turn.
        assert (first["arrivalWindowStart"], first["arrivalWindowEnd"]) == (
            "2026-03-04T06:50:00Z",
            "2026-03-04T07:20:00Z",
        )
        assert second["channel"] == "WALK_IN"

    def test_fr_stf_11_a_client_supplied_position_is_refused(self, opd):
        session = body_of(publish())
        result = ticket(session["sessionId"], position=1)
        assert result["statusCode"] == 400
        assert body_of(result)["detail"]["rule"] == "SERVER_ASSIGNED_ORDER"

    def test_one_place_per_patient_per_session(self, opd):
        session = body_of(publish())
        ticket(session["sessionId"])
        assert ticket(session["sessionId"])["statusCode"] == 409

    def test_a_full_session_refuses(self, opd):
        session = body_of(publish(rostered=1, start="08:00", end="08:30"))
        assert session["capacity"] == 2
        ticket(session["sessionId"])
        ticket(session["sessionId"], context=staff_context(), patientProfileId="pp-2")
        repository_patient = staff_context()
        result = ticket(session["sessionId"], context=repository_patient, patientProfileId="pp-3")
        assert result["statusCode"] in (404, 409)

    def test_a_ticket_is_a_visit_on_the_desks_day(self, opd):
        session = body_of(publish())
        made = body_of(ticket(session["sessionId"]))
        found = body_of(
            call(
                "GET",
                "/appointments/{id}",
                context=staff_context(),
                path={"id": made["appointmentId"]},
            )
        )
        assert (found["sessionId"], found["state"]) == (session["sessionId"], "BOOKED")

    def test_the_patient_gives_up_their_place(self, opd):
        """A ticket holds no clinician and no units, so cancelling frees none (2026-09-28)."""
        session = body_of(publish())
        made = body_of(ticket(session["sessionId"]))
        result = call(
            "DELETE",
            "/appointments/{id}",
            context=patient_context(),
            path={"id": made["appointmentId"]},
            body={},
        )
        assert result["statusCode"] == 200, result["body"]
        assert body_of(result)["state"] == "PATIENT_CANCELLED"

    def test_a_ticket_is_not_moved_like_a_visit(self, opd):
        session = body_of(publish())
        made = body_of(ticket(session["sessionId"]))
        result = call(
            "POST",
            "/appointments/{id}/reschedule",
            context=patient_context(),
            path={"id": made["appointmentId"]},
            body={"startAt": "2026-03-05T08:00:00Z"},
        )
        assert result["statusCode"] == 400


def act(appointment_id, action, context=None, body=None):
    return call(
        "POST",
        f"/appointments/{{id}}/{action}",
        context=context or staff_context(),
        path={"id": appointment_id},
        body=body,
    )


class TestRunningTheQueue:
    def test_fr_bkg_13_a_doctor_is_assigned_when_called(self, opd):
        _repo, clinician = opd
        session = body_of(publish())
        made = body_of(ticket(session["sessionId"]))
        act(made["appointmentId"], "arrive")
        doctor = {
            "personId": "p-doc",
            "tenantId": TENANT,
            "roles": "CLINICIAN",
            "staffId": clinician,
            "clinicId": DOUALA,
        }
        called = body_of(
            call("POST", "/sessions/{id}/next", context=doctor, path={"id": session["sessionId"]})
        )
        assert (called["state"], called["clinicianProfileId"]) == ("IN_CONSULTATION", clinician)

    def test_nobody_arrived_nobody_called(self, opd):
        _repo, clinician = opd
        session = body_of(publish())
        ticket(session["sessionId"])
        doctor = {
            "personId": "p-doc",
            "tenantId": TENANT,
            "roles": "CLINICIAN",
            "staffId": clinician,
            "clinicId": DOUALA,
        }
        assert (
            call("POST", "/sessions/{id}/next", context=doctor, path={"id": session["sessionId"]})[
                "statusCode"
            ]
            == 409
        )

    def test_windows_follow_the_real_pace(self, opd, repository):
        session = body_of(publish(rostered=1))
        first = body_of(ticket(session["sessionId"]))
        second = body_of(
            ticket(session["sessionId"], context=staff_context(), patientProfileId="pp-2")
        )
        # 09:30 in Douala and nobody seen: the second patient's turn has slipped.
        CLOCK["now"] = dt.datetime(2026, 3, 4, 8, 30, tzinfo=dt.UTC)
        live = body_of(
            call(
                "GET",
                "/sessions/{id}/queue",
                context=staff_context(),
                path={"id": session["sessionId"]},
            )
        )
        windows = {a["appointmentId"]: a["arrivalWindowStart"] for a in live["appointments"]}
        assert windows[first["appointmentId"]] > first["arrivalWindowStart"]
        assert windows[second["appointmentId"]] > second["arrivalWindowStart"]
        assert (live["waiting"], live["plannedPerHour"]) == (2, 4.0)

    def test_clinician_in_unit_reads_queue_and_patient_is_forbidden(self, opd):
        _repo, clinician = opd
        session = body_of(publish(rostered=1))
        ticket(session["sessionId"])
        doctor = {
            "personId": "p-doc",
            "tenantId": TENANT,
            "roles": "CLINICIAN",
            "staffId": clinician,
            "clinicId": DOUALA,
        }
        res = call(
            "GET",
            "/sessions/{id}/queue",
            context=doctor,
            path={"id": session["sessionId"]},
        )
        assert res["statusCode"] == 200
        assert body_of(res)["waiting"] == 1

        patient_res = call(
            "GET",
            "/sessions/{id}/queue",
            context=patient_context(),
            path={"id": session["sessionId"]},
        )
        assert patient_res["statusCode"] == 403

    def test_close_measures_and_the_next_session_learns(self, opd):
        _repo, clinician = opd
        session = body_of(publish(rostered=1))
        made = body_of(ticket(session["sessionId"]))
        act(made["appointmentId"], "arrive")
        doctor = {
            "personId": "p-doc",
            "tenantId": TENANT,
            "roles": "CLINICIAN",
            "staffId": clinician,
            "clinicId": DOUALA,
        }
        call("POST", "/sessions/{id}/next", context=doctor, path={"id": session["sessionId"]})
        act(made["appointmentId"], "complete", context=doctor)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 12, 0, tzinfo=dt.UTC)
        closed = body_of(
            call("POST", "/sessions/{id}/close", context=MANAGER, path={"id": session["sessionId"]})
        )
        # One patient in four hours with one doctor.
        assert closed["actualThroughputPerHour"] == "0.25"
        CLOCK["now"] = NOW
        later = body_of(
            call(
                "POST",
                "/clinics/{id}/sessions",
                context=MANAGER,
                path={"id": DOUALA},
                body={
                    "date": "2026-03-05",
                    "startTime": "08:00",
                    "endTime": "12:00",
                    "rosteredClinicianCount": 1,
                },
            )
        )
        assert later["capacity"] == 1  # 4 hours x 1 doctor x 0.25 an hour


class TestOutboxForTheQueue:
    def test_a_moved_window_texts_the_patient_and_moves_the_reminder(self):
        def image(start):
            return {
                name: {"S": value}
                for name, value in {
                    "type": "APPOINTMENT",
                    "tenantId": TENANT,
                    "appointmentId": "a-1",
                    "state": "BOOKED",
                    "sessionId": "se-1",
                    "arrivalWindowStart": start,
                }.items()
            }

        record = {
            "dynamodb": {
                "OldImage": image("2026-03-04T07:00:00Z"),
                "NewImage": image("2026-03-04T08:00:00Z"),
            }
        }
        kinds = [job["kind"] for job in outbox.jobs_due(record)]
        assert kinds == ["QUEUE_MOVED", "CANCEL_REMINDER", "SCHEDULE_REMINDER"]


class TestProcedureRequests:
    def request(self):
        return call(
            "POST",
            "/procedure-requests",
            context=patient_context(),
            body={
                "appointmentTypeId": "at-minor",
                "clinicId": DOUALA,
                "note": "A cyst on my wrist",
            },
        )

    def test_fr_bkg_14_a_request_holds_no_time(self, opd):
        made = body_of(self.request())
        assert (made["state"], made["clinicianProfileId"], made["requestNote"]) == (
            "REQUESTED",
            None,
            "A cyst on my wrist",
        )

    def test_only_a_requestable_procedure(self, opd):
        result = call(
            "POST",
            "/procedure-requests",
            context=patient_context(),
            body={"appointmentTypeId": "at-gen", "clinicId": DOUALA},
        )
        assert result["statusCode"] == 400

    def test_fr_stf_15_the_inbox_lists_it_and_staff_place_it(self, opd, repository):
        _repo, clinician = opd
        made = body_of(self.request())
        inbox = body_of(call("GET", "/clinics/{id}/requests", context=MANAGER, path={"id": DOUALA}))
        assert [a["appointmentId"] for a in inbox["appointments"]] == [made["appointmentId"]]
        placed = act(
            made["appointmentId"],
            "place",
            context=MANAGER,
            body={
                "clinicianProfileId": clinician,
                "startAt": "2026-03-04T09:00:00Z",
                "durationUnits": 6,
            },
        )
        assert placed["statusCode"] == 200
        assert (body_of(placed)["state"], body_of(placed)["clinicianProfileId"]) == (
            "BOOKED",
            clinician,
        )
        assert repository.get(keys.slot_lock(TENANT, clinician, "2026-03-04T09:00:00Z")) is not None
        assert (
            body_of(call("GET", "/clinics/{id}/requests", context=MANAGER, path={"id": DOUALA}))[
                "count"
            ]
            == 0
        )

    def test_the_desk_cannot_place(self, opd):
        _repo, clinician = opd
        made = body_of(self.request())
        refused = act(
            made["appointmentId"],
            "place",
            body={"clinicianProfileId": clinician, "startAt": "2026-03-04T09:00:00Z"},
        )
        assert refused["statusCode"] == 403

    def test_declined_with_a_reason(self, opd):
        made = body_of(self.request())
        assert act(made["appointmentId"], "decline", context=MANAGER, body={})["statusCode"] == 400
        declined = body_of(
            act(
                made["appointmentId"],
                "decline",
                context=MANAGER,
                body={"reason": "Needs a surgical review first"},
            )
        )
        assert (declined["state"], declined["declineReason"]) == (
            "DECLINED",
            "Needs a surgical review first",
        )


class TestIndexKeys:
    def test_a_ticket_and_a_request_carry_no_null_index_key(self, opd, repository):
        """DynamoDB refuses a null value for an index key (moto does not), so the
        clinician is absent until assigned, never null (found on dev 2026-09-27)."""
        session = body_of(publish())
        made = body_of(ticket(session["sessionId"]))
        stored = repository.get(keys.appointment(TENANT, made["appointmentId"]))
        assert "clinicianProfileId" not in stored
        asked = body_of(
            call(
                "POST",
                "/procedure-requests",
                context=patient_context(),
                body={"appointmentTypeId": "at-minor", "clinicId": DOUALA},
            )
        )
        assert "clinicianProfileId" not in repository.get(
            keys.appointment(TENANT, asked["appointmentId"])
        )


class TestDeletingTheAccount:
    """Deleting an account gives up its queue places too (2026-09-29)."""

    def test_the_ticket_is_cancelled_with_the_account(self, opd, repository, monkeypatch):
        session_id = body_of(publish())["sessionId"]
        made = body_of(ticket(session_id))
        repository.put(
            keys.patient_profile(TENANT, PATIENT),
            {
                **(repository.get(keys.patient_profile(TENANT, PATIENT)) or {}),
                "personId": "p-patient",
            },
        )
        repository.put(keys.person("p-patient"), {"type": "PERSON", "personId": "p-patient"})
        from atria.data.people import People
        from atria.http import requests
        from atria.services.identity import deletion

        monkeypatch.setattr(deletion, "sign_in", lambda *a, **k: None)  # no pool in a test
        me = requests.principal_from({"requestContext": {"authorizer": patient_context()}})
        found = deletion.delete_own(People(repository), me, now=CLOCK["now"])
        assert found["cancelledVisits"] == 1
        state = repository.get(keys.appointment(TENANT, made["appointmentId"]))["state"]
        assert "CANCELLED" in state
