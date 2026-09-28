# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""The staff console: register, record, booking for a patient, roster, weekly list.

Verifies FR-STF-06 (search by name, phone or patient number), FR-STF-07 (the
record within the viewer's scope, never care context), FR-BKG-07 (a minimal
record and a booking for it, attributed to staff), FR-STF-14 (the channel,
with a callback number or referral details), FR-STF-08 (the roster with shift
status and load), FR-STF-12 (no moving someone later near one's own visit,
except a manager, flagged) and FR-STF-13 (the manager's weekly list, and the
priority allowance as the only staff priority).

The wiring, the clinician and the booking helper are the cancellation tests'.
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
    START,
    TENANT,
    TYPE_ID,
    body_of,
    book,
    cancel,
    staff_context,
    wired,
)

from atria.data import keys, register
from atria.data.people import People
from atria.services.audit import log as audit_service
from atria.services.booking import appointments as booking_service
from atria.services.directory import clinicians as directory
from atria.services.identity import staff as staff_service
from atria.services.patients import register as register_service

pytestmark = pytest.mark.usefixtures("table")

MANAGER = staff_context(personId="p-mgr", roles="CLINIC_MANAGER", staffId="s-mgr")
ADMIN = {"personId": "p-admin", "tenantId": TENANT, "roles": "TENANT_ADMIN", "staffId": "s-admin"}


@pytest.fixture
def desk(wired, repository, monkeypatch):
    register_service.use(repository)
    monkeypatch.setattr(staff_service, "_people", People(repository))
    repository.put(
        keys.person("p-amina"),
        {
            "type": "PERSON",
            "personId": "p-amina",
            "givenName": "Amina",
            "familyName": "Ngô",
            "phoneE164": "+237691000001",
        },
    )
    profile = repository.get(keys.patient_profile(TENANT, PATIENT))
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {**profile, "personId": "p-amina", "patientNumber": "RHB-000001"},
    )
    for key, item in register.entries(
        tenant_id=TENANT,
        patient_profile_id=PATIENT,
        person_id="p-amina",
        given_name="Amina",
        family_name="Ngô",
        phone_e164="+237691000001",
        patient_number="RHB-000001",
    ):
        repository.put(key, item)
    type_key = keys.appointment_type(TENANT, TYPE_ID)
    repository.put(type_key, {**repository.get(type_key), "serviceLine": "SPECIALIST"})
    yield wired
    register_service.use(None)


def call(handler, method, resource, *, context, body=None, path=None, query=None):
    return handler(
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


def search(q, context=None):
    return call(
        register_service.handler,
        "GET",
        "/patients",
        context=context or staff_context(),
        query={"q": q},
    )


class TestRegister:
    @pytest.mark.parametrize(
        "q", ["ngo", "Amina", "NGO AM", "+237691000001", "691 000 001", "RHB-000001", "rhb000001"]
    )
    def test_fr_stf_06_found_by_name_phone_or_number(self, desk, q):
        found = body_of(search(q))
        assert [r["patientProfileId"] for r in found["results"]] == [PATIENT]

    def test_one_letter_finds_nothing(self, desk):
        assert body_of(search("n"))["results"] == []

    def test_no_search_lists_the_register(self, desk):
        """The Patients page opens on the register itself (2026-09-28)."""
        found = body_of(search(""))
        assert [r["patientProfileId"] for r in found["results"]] == [PATIENT]
        assert (found["count"], found["nextCursor"]) == (1, None)

    def test_the_listing_is_audited_like_a_search(self, desk, audit_log):
        search("")
        today = audit_log.now().date()
        (entry,) = audit_log.entries(TENANT, today, today)
        assert entry["patientProfileIds"] == [PATIENT]

    def test_a_patient_cannot_search(self, desk):
        patient = {
            "personId": "p-x",
            "tenantId": TENANT,
            "roles": "PATIENT",
            "patientProfileId": "pp-x",
        }
        assert search("ngo", patient)["statusCode"] == 403

    def test_a_search_is_audited_naming_who_it_showed(self, desk, audit_log):
        search("ngo")
        today = audit_log.now().date()
        (entry,) = audit_log.entries(TENANT, today, today)
        assert (entry["action"], entry["patientProfileIds"]) == ("patient.search", [PATIENT])


NEW = {
    "givenName": "Brice",
    "familyName": "Tagne",
    "phoneE164": "+237677000002",
    "dateOfBirth": "1990-05-02",
}


class TestMinimalRecord:
    def test_fr_bkg_07_the_desk_makes_a_record_with_a_number(self, desk, repository):
        repository.put(
            keys.tenant(TENANT),
            {**repository.get(keys.tenant(TENANT)), "patientNumberPrefix": "RHB"},
        )
        made = body_of(
            call(register_service.handler, "POST", "/patients", context=staff_context(), body=NEW)
        )
        assert made["patientNumber"] == "RHB-000001"
        assert [r["patientProfileId"] for r in body_of(search("tagne"))["results"]] == [
            made["patientProfileId"]
        ]
        second = body_of(
            call(
                register_service.handler,
                "POST",
                "/patients",
                context=staff_context(),
                body={**NEW, "phoneE164": "+237677000003"},
            )
        )
        assert second["patientNumber"] == "RHB-000002"

    def test_a_shared_number_is_shown_before_a_second_record(self, desk):
        again = call(
            register_service.handler,
            "POST",
            "/patients",
            context=staff_context(),
            body={**NEW, "phoneE164": "+237691000001"},
        )
        assert again["statusCode"] == 409
        assert body_of(again)["detail"]["patients"][0]["patientProfileId"] == PATIENT
        confirmed = call(
            register_service.handler,
            "POST",
            "/patients",
            context=staff_context(),
            body={**NEW, "phoneE164": "+237691000001", "sameNumberConfirmed": True},
        )
        assert confirmed["statusCode"] == 201

    def test_a_number_must_be_a_mobile(self, desk):
        bad = call(
            register_service.handler,
            "POST",
            "/patients",
            context=staff_context(),
            body={**NEW, "phoneE164": "12345"},
        )
        assert bad["statusCode"] == 400

    def test_then_booked_for_by_phone_with_a_callback(self, desk):
        _repo, clinician = desk
        made = body_of(
            call(register_service.handler, "POST", "/patients", context=staff_context(), body=NEW)
        )
        booked = call(
            booking_service.handler,
            "POST",
            "/appointments",
            context=staff_context(),
            body={
                "patientProfileId": made["patientProfileId"],
                "appointmentTypeId": TYPE_ID,
                "clinicianProfileId": clinician,
                "startAt": START,
                "channel": "PHONE",
                "callbackPhone": "+237677000002",
            },
        )
        assert booked["statusCode"] == 201
        found = body_of(booked)
        assert (found["channel"], found["bookedByRole"]) == ("PHONE", "RECEPTIONIST")


class TestRecord:
    def test_fr_stf_07_contact_verification_and_visits_in_scope(self, desk):
        _repo, clinician = desk
        booked = book(clinician)
        record = body_of(
            call(
                register_service.handler,
                "GET",
                "/patients/{id}",
                context=staff_context(),
                path={"id": PATIENT},
            )
        )
        assert (record["givenName"], record["phoneE164"], record["patientNumber"]) == (
            "Amina",
            "+237691000001",
            "RHB-000001",
        )
        assert record["hasAccount"] is False
        assert [a["appointmentId"] for a in record["appointments"]] == [booked["appointmentId"]]
        assert not [k for k in record if k.startswith("careContext")]

    def test_another_units_desk_sees_none_of_the_visits(self, desk):
        _repo, clinician = desk
        book(clinician)
        other = staff_context(clinicId="c-elsewhere")
        record = body_of(
            call(
                register_service.handler,
                "GET",
                "/patients/{id}",
                context=other,
                path={"id": PATIENT},
            )
        )
        assert record["appointments"] == []

    def test_opening_a_record_is_audited(self, desk, audit_log):
        call(
            register_service.handler,
            "GET",
            "/patients/{id}",
            context=staff_context(),
            path={"id": PATIENT},
        )
        today = audit_log.now().date()
        (entry,) = audit_log.entries(TENANT, today, today)
        assert (entry["action"], entry["subjectId"]) == ("patient.read", PATIENT)


def staff_book(clinician, **extra):
    return call(
        booking_service.handler,
        "POST",
        "/appointments",
        context=staff_context(),
        body={
            "patientProfileId": PATIENT,
            "appointmentTypeId": TYPE_ID,
            "clinicianProfileId": clinician,
            "startAt": START,
            **extra,
        },
    )


class TestChannels:
    def test_fr_stf_14_a_referral_is_kept_with_the_visit(self, desk, repository):
        _repo, clinician = desk
        booked = body_of(
            staff_book(
                clinician,
                channel="REFERRAL",
                referringFacility="Muea Integrated Health Centre",
                referringClinicianName="Nurse Ekema",
                referralNote="Recurrent chest pain",
            )
        )
        referral = repository.get(keys.referral(TENANT, booked["appointmentId"]))
        assert referral["referringFacility"] == "Muea Integrated Health Centre"
        assert booked["channel"] == "REFERRAL"

    def test_a_walk_in_is_for_today(self, desk):
        _repo, clinician = desk
        refused = staff_book(clinician, channel="WALK_IN")
        assert refused["statusCode"] == 400
        assert "today" in body_of(refused)["message"]

    def test_staff_cannot_claim_online(self, desk):
        _repo, clinician = desk
        assert staff_book(clinician, channel="ONLINE")["statusCode"] == 400


class TestRoster:
    def test_fr_stf_08_shift_status_and_load(self, desk):
        _repo, clinician = desk
        book(clinician)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 8, 30, tzinfo=dt.UTC)  # 09:30 in Douala
        found = body_of(
            call(
                directory.handler,
                "GET",
                "/clinics/{id}/roster",
                context=staff_context(),
                path={"id": DOUALA},
            )
        )
        (row,) = found["clinicians"]
        assert row["status"] == "ON_SHIFT"
        assert (row["visits"], row["bookedMinutes"]) == (1, 30)
        assert row["load"] == round(30 / (9 * 60), 2)

    def test_a_clinician_cannot_read_the_units_roster(self, desk):
        _repo, clinician = desk
        own = {
            "personId": "p-c",
            "tenantId": TENANT,
            "roles": "CLINICIAN",
            "staffId": clinician,
            "clinicId": DOUALA,
        }
        result = call(
            directory.handler, "GET", "/clinics/{id}/roster", context=own, path={"id": DOUALA}
        )
        assert result["statusCode"] in (200, 403)


def put_own_visit(repository, clinician, start):
    repository.put(
        keys.patient_profile(TENANT, "pp-rec"),
        {"type": "PATIENT_PROFILE", "patientProfileId": "pp-rec", "tenantId": TENANT},
    )
    repository.put(
        keys.appointment(TENANT, "a-own"),
        {
            "type": "APPOINTMENT",
            "appointmentId": "a-own",
            "tenantId": TENANT,
            "clinicId": DOUALA,
            "patientProfileId": "pp-rec",
            "clinicianProfileId": clinician,
            "startAt": start,
            "endAt": start,
            "state": "BOOKED",
        },
    )


def move(appointment_id, start, context):
    return call(
        booking_service.handler,
        "POST",
        "/appointments/{id}/reschedule",
        context=context,
        path={"id": appointment_id},
        body={"startAt": start, "rescheduledBy": "CLINIC", "reason": "clinic running late"},
    )


class TestNoSelfBenefit:
    def test_fr_stf_12_the_desk_cannot_move_someone_later_near_its_own_visit(
        self, desk, repository
    ):
        _repo, clinician = desk
        booked = book(clinician)
        put_own_visit(repository, clinician, "2026-03-04T09:00:00Z")
        refused = move(
            booked["appointmentId"],
            "2026-03-04T12:00:00Z",
            staff_context(patientProfileId="pp-rec"),
        )
        assert refused["statusCode"] == 403
        assert "unit manager" in body_of(refused)["message"]

    def test_a_manager_may_and_it_is_flagged(self, desk, repository, audit_log):
        _repo, clinician = desk
        booked = book(clinician)
        put_own_visit(repository, clinician, "2026-03-04T09:00:00Z")
        moved = move(
            booked["appointmentId"],
            "2026-03-04T12:00:00Z",
            {**MANAGER, "patientProfileId": "pp-rec"},
        )
        assert moved["statusCode"] == 200
        today = audit_log.now().date()
        (entry,) = [
            e
            for e in audit_log.entries(TENANT, today, today)
            if e["action"] == "appointment.reschedule"
        ]
        assert entry["flags"] == ["POTENTIAL_SELF_BENEFIT"]

    def test_moving_earlier_is_not_refused(self, desk, repository):
        _repo, clinician = desk
        booked = book(clinician, start="2026-03-04T12:00:00Z")
        put_own_visit(repository, clinician, "2026-03-04T13:00:00Z")
        moved = move(
            booked["appointmentId"],
            "2026-03-04T09:00:00Z",
            staff_context(patientProfileId="pp-rec"),
        )
        assert moved["statusCode"] == 200


class TestWeeklyList:
    def test_fr_stf_13_changes_grouped_by_who_made_them(self, desk):
        _repo, clinician = desk
        first = book(clinician)
        second = book(clinician, start="2026-03-05T08:00:00Z")
        cancel(
            first["appointmentId"],
            context=staff_context(),
            body={"cancelledBy": "PATIENT", "reason": "phoned"},
        )
        move(second["appointmentId"], "2026-03-05T10:00:00Z", MANAGER)
        found = body_of(call(audit_service.handler, "GET", "/audit/changes", context=MANAGER))
        assert found["total"] == 2
        by = {g["actorPersonId"]: g for g in found["actors"]}
        assert (by["p-rec"]["cancellations"], by["p-mgr"]["reschedules"]) == (1, 1)
        assert by["p-rec"]["changes"][0]["reason"] == "phoned"

    def test_the_desk_does_not_read_it(self, desk):
        assert (
            call(audit_service.handler, "GET", "/audit/changes", context=staff_context())[
                "statusCode"
            ]
            == 403
        )


class TestPriorityAllowance:
    def grant(self, staff_id, quota, context=ADMIN):
        return call(
            staff_service.handler,
            "PUT",
            "/admin/staff/{id}/priority-allowance",
            context=context,
            path={"id": staff_id},
            body={"quotaPerMonth": quota},
        )

    def test_an_administrator_grants_a_bounded_allowance(self, desk):
        _repo, clinician = desk
        granted = body_of(self.grant(clinician, 2))
        assert granted["priorityAllowance"]["quotaPerMonth"] == 2
        assert granted["priorityAllowance"]["usedThisMonth"] == 0
        assert self.grant(clinician, 11)["statusCode"] == 400

    def test_nobody_else_can(self, desk):
        _repo, clinician = desk
        assert self.grant(clinician, 1, MANAGER)["statusCode"] == 403

    def test_zero_withdraws_it(self, desk):
        _repo, clinician = desk
        self.grant(clinician, 2)
        assert body_of(self.grant(clinician, 0))["priorityAllowance"] is None
