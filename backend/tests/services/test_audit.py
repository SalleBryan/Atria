# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""The audit trail: written for every staff access, read back by who may.

Verifies FR-PRV-06 (every staff read and write of patient data is recorded
with actor, action, record, time and source), FR-ADM-04 (the log is read,
filtered by actor, action and date, and exported, and an entry cannot be
written twice), FR-ADM-05 (the console lists counts, not patients, and the
export is itself recorded) and guard REASONED_AND_AUDITED (a reason is kept,
and a change near the actor's own visit is flagged).

The wiring, the clinician and the booking helper are the cancellation tests'.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from test_appointment_cancel import (
    DOUALA,
    PATIENT,
    START,
    TENANT,
    body_of,
    book,
    cancel,
    staff_context,
    wired,
)

from atria.core.errors import Conflict
from atria.data import keys
from atria.data.audit import AuditLog
from atria.data.people import People
from atria.http import audit
from atria.services.audit import log as audit_service
from atria.services.booking import appointments as booking_service
from atria.services.directory import clinicians as directory

pytestmark = pytest.mark.usefixtures("table")

SOURCE = {"sourceIp": "196.202.1.10"}


def event(method: str, resource: str, *, context, path=None, body=None, query=None):
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": path,
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
        "headers": {"User-Agent": "Mozilla/5.0 test"},
        "requestContext": {"authorizer": context, "identity": SOURCE, "requestId": "req-1"},
    }


def read_one(appointment_id: str, context):
    return booking_service.handler(
        event("GET", "/appointments/{id}", context=context, path={"id": appointment_id}), None
    )


def written(audit_log: AuditLog) -> list[dict]:
    today = audit_log.now().date()
    return audit_log.entries(TENANT, today, today)


def manager_context(**extra):
    return staff_context(personId="p-mgr", roles="CLINIC_MANAGER", staffId="s-mgr", **extra)


def admin_context():
    return {"personId": "p-admin", "tenantId": TENANT, "roles": "TENANT_ADMIN"}


def listing(context, **query):
    return audit_service.handler(event("GET", "/audit", context=context, query=query or None), None)


class TestWhatIsRecorded:
    def test_fr_prv_06_a_staff_read_names_actor_record_time_and_source(self, wired, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        assert read_one(booked["appointmentId"], staff_context())["statusCode"] == 200

        (entry,) = written(audit_log)
        assert entry["actorPersonId"] == "p-rec"
        assert entry["actorRole"] == "RECEPTIONIST"
        assert entry["action"] == "appointment.read"
        assert entry["kind"] == "READ"
        assert (entry["subjectType"], entry["subjectId"]) == (
            "APPOINTMENT",
            booked["appointmentId"],
        )
        assert entry["patientProfileIds"] == [PATIENT]
        assert entry["clinicId"] == DOUALA
        assert entry["source"] == {
            "ip": "196.202.1.10",
            "userAgent": "Mozilla/5.0 test",
            "requestId": "req-1",
        }
        assert entry["occurredAt"].endswith("Z")

    def test_a_staff_change_keeps_its_reason(self, wired, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        cancel(
            booked["appointmentId"],
            context=staff_context(),
            body={"cancelledBy": "PATIENT", "reason": "the patient phoned the desk"},
        )
        (entry,) = written(audit_log)
        assert entry["action"] == "appointment.cancel"
        assert entry["kind"] == "WRITE"
        assert entry["reason"] == "the patient phoned the desk"
        assert entry["flags"] == []

    def test_a_patient_on_their_own_record_is_not_recorded(self, wired, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        cancel(booked["appointmentId"])
        assert written(audit_log) == []

    def test_staff_on_their_own_visit_are_the_patient_and_not_recorded(self, wired, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        assert (
            read_one(booked["appointmentId"], staff_context(patientProfileId=PATIENT))["statusCode"]
            == 200
        )
        assert written(audit_log) == []

    def test_a_refused_request_is_not_an_access(self, wired, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        other = staff_context(clinicId="c-elsewhere")
        assert read_one(booked["appointmentId"], other)["statusCode"] == 403
        assert written(audit_log) == []

    def test_a_day_list_names_every_patient_on_it(self, wired, audit_log):
        _repo, clinician = wired
        book(clinician)
        result = directory.handler(
            event(
                "GET",
                "/clinics/{id}/day",
                context=staff_context(),
                path={"id": DOUALA},
                query={"date": START[:10]},
            ),
            None,
        )
        assert result["statusCode"] == 200
        (entry,) = written(audit_log)
        assert (entry["action"], entry["subjectId"]) == ("schedule.day", DOUALA)
        assert entry["patientProfileIds"] == [PATIENT]

    def test_an_empty_day_showed_nobody_and_is_not_recorded(self, wired, audit_log):
        directory.handler(
            event(
                "GET",
                "/clinics/{id}/day",
                context=staff_context(),
                path={"id": DOUALA},
                query={"date": "2026-03-05"},
            ),
            None,
        )
        assert written(audit_log) == []

    def test_a_read_that_cannot_be_recorded_is_not_answered(self, wired, monkeypatch, audit_log):
        """Failing closed: data nobody will know was seen is worse than a 500."""
        _repo, clinician = wired
        booked = book(clinician)

        def broken(_item):
            raise RuntimeError("table unavailable")

        monkeypatch.setattr(audit_log, "record", broken)
        result = read_one(booked["appointmentId"], staff_context())
        assert result["statusCode"] == 500
        assert PATIENT not in result["body"]

    def test_a_change_that_cannot_be_recorded_still_reports_its_outcome(
        self, wired, monkeypatch, audit_log
    ):
        _repo, clinician = wired
        booked = book(clinician)
        monkeypatch.setattr(audit_log, "record", lambda _item: 1 / 0)
        result = cancel(
            booked["appointmentId"],
            context=staff_context(),
            body={"cancelledBy": "PATIENT", "reason": "phoned"},
        )
        assert result["statusCode"] == 200


def read_queue(context, *patients: str, session: str = "ses-1"):
    """The recorder seeing one load of the live queue, showing `patients`."""
    body = {"appointments": [{"patientProfileId": p, "clinicId": DOUALA} for p in patients]}
    return audit.after(
        event("GET", "/sessions/{id}/queue", context=context, path={"id": session}),
        {"statusCode": 200, "body": json.dumps(body)},
    )


class TestAQueueThatRefreshesItself:
    """The desk's queue reloads every 30 seconds; a viewing is one entry, not one per reload."""

    @pytest.fixture
    def clock(self, audit_log, monkeypatch):
        now = [dt.datetime(2026, 10, 7, 8, 0, tzinfo=dt.UTC)]
        monkeypatch.setattr(audit_log, "_clock", lambda: now[0])

        def later(seconds: int) -> None:
            now[0] += dt.timedelta(seconds=seconds)

        return later

    def test_refreshes_showing_the_same_patients_are_one_entry(self, audit_log, clock):
        for _ in range(10):
            read_queue(staff_context(), "pp-1", "pp-2")
            clock(30)
        (entry,) = written(audit_log)
        assert entry["action"] == "queue.read"
        assert entry["patientProfileIds"] == ["pp-1", "pp-2"]

    def test_a_patient_joining_the_queue_is_recorded(self, audit_log, clock):
        read_queue(staff_context(), "pp-1")
        clock(30)
        read_queue(staff_context(), "pp-1", "pp-2")
        clock(30)
        read_queue(staff_context(), "pp-1", "pp-2")
        assert [e["patientProfileIds"] for e in written(audit_log)] == [
            ["pp-1", "pp-2"],
            ["pp-1"],
        ]

    def test_coming_back_to_the_screen_is_a_new_viewing(self, audit_log, clock):
        read_queue(staff_context(), "pp-1")
        clock(5 * 60)
        read_queue(staff_context(), "pp-1")
        assert len(written(audit_log)) == 2

    def test_each_person_and_each_queue_is_its_own_viewing(self, audit_log, clock):
        read_queue(staff_context(), "pp-1")
        read_queue(manager_context(), "pp-1")
        read_queue(staff_context(), "pp-1", session="ses-2")
        assert len(written(audit_log)) == 3

    def test_a_read_that_was_not_recorded_does_not_start_a_viewing(
        self, audit_log, clock, monkeypatch
    ):
        """Fail closed: the next load must be recorded, not taken as a refresh."""
        recorded = audit_log.record
        monkeypatch.setattr(audit_log, "record", lambda _item: 1 / 0)
        with pytest.raises(ZeroDivisionError):
            read_queue(staff_context(), "pp-1")
        monkeypatch.setattr(audit_log, "record", recorded)
        clock(30)
        read_queue(staff_context(), "pp-1")
        assert len(written(audit_log)) == 1

    def test_other_reads_are_recorded_every_time(self, wired, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        read_one(booked["appointmentId"], staff_context())
        read_one(booked["appointmentId"], staff_context())
        assert len(written(audit_log)) == 2


class TestSelfBenefit:
    def test_a_move_near_the_actors_own_visit_is_flagged(self, wired, repository, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        # The receptionist is a patient too, with the same clinician the next hour.
        repository.put(
            keys.patient_profile(TENANT, "pp-rec"),
            {"type": "PATIENT_PROFILE", "patientProfileId": "pp-rec", "tenantId": TENANT},
        )
        own = dict(booking_service.booking().appointment(TENANT, booked["appointmentId"]))
        own.update(
            appointmentId="a-own",
            patientProfileId="pp-rec",
            startAt="2026-03-04T09:00:00Z",
            endAt="2026-03-04T09:30:00Z",
        )
        repository.put(keys.appointment(TENANT, "a-own"), own)

        cancel(
            booked["appointmentId"],
            context=staff_context(patientProfileId="pp-rec"),
            body={"cancelledBy": "CLINIC", "reason": "clinic running late"},
        )
        (entry,) = written(audit_log)
        assert entry["flags"] == ["POTENTIAL_SELF_BENEFIT"]

    def test_the_flag_does_not_carry_into_the_next_request(self, wired, audit_log):
        audit.note("POTENTIAL_SELF_BENEFIT")
        _repo, clinician = wired
        booked = book(clinician)
        read_one(booked["appointmentId"], staff_context())
        (entry,) = written(audit_log)
        assert entry["flags"] == []


class TestImmutable:
    def test_fr_adm_04_an_entry_cannot_be_written_twice(self, wired, audit_log):
        _repo, clinician = wired
        booked = book(clinician)
        read_one(booked["appointmentId"], staff_context())
        (entry,) = written(audit_log)
        with pytest.raises(Conflict):
            audit_log.record({**entry, "reason": "rewritten"})


class TestReadingTheLog:
    @pytest.fixture
    def history(self, wired, repository, audit_log):
        """One read in Douala, one in another unit, one cancellation in Douala."""
        _repo, clinician = wired
        for person_id, given in (("p-rec", "Ruth"), ("p-mgr", "Marc")):
            repository.put(
                keys.person(person_id),
                {"type": "PERSON", "personId": person_id, "givenName": given, "familyName": "Test"},
            )
        booked = book(clinician)
        read_one(booked["appointmentId"], staff_context())
        audit_log.record(
            {
                **written(audit_log)[0],
                "auditEntryId": "au-elsewhere",
                "clinicId": "c-elsewhere",
                "actorPersonId": "p-other",
            }
        )
        cancel(
            booked["appointmentId"],
            context=staff_context(),
            body={"cancelledBy": "PATIENT", "reason": "phoned"},
        )
        return booked

    def test_a_tenant_administrator_reads_every_unit(self, history):
        found = body_of(listing(admin_context()))
        assert found["count"] == 3
        assert [e["action"] for e in found["entries"]][0] == "appointment.cancel"

    def test_a_unit_manager_reads_their_unit_only(self, history):
        found = body_of(listing(manager_context()))
        assert found["count"] == 2
        assert {e["clinicId"] for e in found["entries"]} == {DOUALA}

    def test_a_receptionist_cannot_read_it(self, history):
        assert listing(staff_context())["statusCode"] == 403

    def test_fr_adm_05_entries_count_patients_rather_than_name_them(self, history):
        found = body_of(listing(admin_context()))
        entry = found["entries"][0]
        assert entry["patientCount"] == 1
        assert "patientProfileIds" not in entry
        assert PATIENT not in json.dumps(found)

    def test_fr_adm_04_filters_by_actor_and_action(self, history):
        by_actor = body_of(listing(admin_context(), actor="p-rec"))
        assert by_actor["count"] == 2
        assert {e["actorName"] for e in by_actor["entries"]} == {"Ruth Test"}
        by_action = body_of(listing(admin_context(), action="appointment.cancel"))
        assert by_action["count"] == 1
        family = body_of(listing(admin_context(), action="appointment"))
        assert family["count"] == 3
        reads = body_of(listing(admin_context(), kind="read"))
        assert {e["kind"] for e in reads["entries"]} == {"READ"}
        assert listing(admin_context(), kind="sideways")["statusCode"] == 400
        # The filter menus still list everyone in the range.
        assert {a["personId"] for a in by_actor["actors"]} == {"p-rec", "p-other"}

    def test_fr_adm_04_filters_by_date(self, history, audit_log):
        today = audit_log.now().date()
        before = (today - dt.timedelta(days=3)).isoformat()
        found = body_of(listing(admin_context(), **{"from": before, "to": before}))
        assert found["count"] == 0
        assert (
            listing(admin_context(), **{"from": "2026-01-01", "to": "2026-03-01"})["statusCode"]
            == 400
        )

    def test_fr_adm_04_the_export_is_a_csv_and_is_itself_recorded(self, history, audit_log):
        result = audit_service.handler(event("GET", "/audit/export", context=admin_context()), None)
        assert result["statusCode"] == 200
        assert result["headers"]["Content-Type"].startswith("text/csv")
        assert "attachment" in result["headers"]["Content-Disposition"]
        lines = result["body"].lstrip("﻿").strip().split("\r\n")
        assert lines[0].startswith("When (UTC),Who,Role,Action,Action code")
        assert len(lines) == 4
        assert PATIENT in result["body"]
        assert written(audit_log)[0]["action"] == "audit.export"
