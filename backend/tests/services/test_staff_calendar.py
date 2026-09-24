"""A clinician's calendar, and a clinic's day, for the people allowed each.

Verifies FR-STF-01 (a clinician views their own calendar; a receptionist and a
clinic manager view any clinician's day in their clinic) and FR-STF-09 (staff
see only their own tenant).

The appointments here are made through the real booking endpoint rather than
written by hand, so these tests also prove what the booking writes: that an
appointment is filed under its clinic's local date and not the UTC one.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from atria.core import staff as staff_rules
from atria.data import keys
from atria.data.booking import Booking
from atria.data.people import People
from atria.http import views
from atria.services.booking import appointments as booking_service
from atria.services.directory import clinicians as service

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
YAOUNDE = "c-yaounde-01"
PATIENT = "pp-1"
TYPE_ID = "at-spec-first"

# 1 March, 06:00 UTC, which is 07:00 in Douala.
NOW = dt.datetime(2026, 3, 1, 6, 0, tzinfo=dt.UTC)


def clinician(people: People, family: str, clinic: str, phone: str) -> str:
    _person, membership = people.create_staff_account(
        tenant_id=TENANT,
        account=staff_rules.StaffAccount(
            given_name="Paul",
            family_name=family,
            phone_e164=phone,
            roles=("CLINICIAN",),
            clinic_id=clinic,
            specialty="Paediatrics",
            registration_year=2012,
            ordre_number=f"CM-ONMC-{family}",
            languages=("fr",),
        ),
    )
    return str(membership["staffMembershipId"])


@pytest.fixture
def world(monkeypatch, repository):
    booking = Booking(repository, clock=lambda: NOW)
    people = People(repository)
    monkeypatch.setattr(service, "_booking", booking)
    monkeypatch.setattr(service, "_people", people)
    monkeypatch.setattr(booking_service, "_booking", booking)

    repository.put(
        keys.tenant(TENANT),
        {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10, "regionPackCode": "CM"},
    )
    repository.put(
        keys.region_pack("CM"), {"type": "REGION_PACK", "code": "CM", "timezone": "Africa/Douala"}
    )
    for clinic in (DOUALA, YAOUNDE):
        repository.put(
            keys.clinic(TENANT, clinic),
            {"type": "CLINIC", "clinicId": clinic, "tenantId": TENANT, "name": clinic},
        )
    repository.put(
        keys.appointment_type(TENANT, TYPE_ID),
        {
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": TYPE_ID,
            "tenantId": TENANT,
            "durationUnits": 3,
            "bufferUnits": 0,
            "bookableBy": "BOTH",
            "minNoticeMinutes": 0,
            "maxAdvanceDays": 60,
            "active": True,
        },
    )
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {"type": "PATIENT_PROFILE", "patientProfileId": PATIENT, "tenantId": TENANT},
    )
    ids = {
        "etoa": clinician(people, "Etoa", DOUALA, "+237600000010"),
        "abena": clinician(people, "Abena", DOUALA, "+237600000011"),
        "manga": clinician(people, "Manga", YAOUNDE, "+237600000012"),
    }
    return repository, ids


def book(clinician_id: str, start: str) -> dict:
    result = booking_service.handler(
        {
            "httpMethod": "POST",
            "resource": "/appointments",
            "body": json.dumps(
                {
                    "patientProfileId": PATIENT,
                    "appointmentTypeId": TYPE_ID,
                    "clinicianProfileId": clinician_id,
                    "startAt": start,
                }
            ),
            "requestContext": {
                "authorizer": {
                    "personId": "p-rec",
                    "tenantId": TENANT,
                    "roles": "RECEPTIONIST",
                    "staffId": "s-rec",
                    "clinicId": DOUALA,
                }
            },
        },
        None,
    )
    assert result["statusCode"] == 201, result["body"]
    return json.loads(str(result["body"]))


def get(resource: str, path_id: str, query: dict | None = None, **context) -> dict:
    authorizer = {"personId": "p-1", "tenantId": TENANT}
    authorizer.update(context)
    return service.handler(
        {
            "httpMethod": "GET",
            "resource": resource,
            "pathParameters": {"id": path_id},
            "queryStringParameters": query,
            "requestContext": {"authorizer": authorizer},
        },
        None,
    )


def as_clinician(staff_id: str, clinic: str = DOUALA) -> dict:
    return {"roles": "CLINICIAN", "staffId": staff_id, "clinicId": clinic}


def as_receptionist(clinic: str = DOUALA) -> dict:
    return {"roles": "RECEPTIONIST", "staffId": "s-rec", "clinicId": clinic}


def body_of(result) -> dict:
    return json.loads(str(result["body"]))


def day(date: str | None = None, clinic: str = DOUALA, **context) -> dict:
    """GET /clinics/{id}/day as a receptionist of Douala unless told otherwise."""
    who = context or as_receptionist()
    return get("/clinics/{id}/day", clinic, {"date": date} if date else None, **who)


@pytest.fixture
def booked(world):
    repository, ids = world
    made = {
        "etoa_monday": book(ids["etoa"], "2026-03-02T08:00:00Z"),
        "etoa_tuesday": book(ids["etoa"], "2026-03-03T09:00:00Z"),
        "abena_monday": book(ids["abena"], "2026-03-02T10:00:00Z"),
        # 00:30 on 3 March in Douala, which is 23:30 UTC on 2 March.
        "etoa_after_midnight": book(ids["etoa"], "2026-03-02T23:30:00Z"),
    }
    return repository, ids, made


class TestLocalDay:
    def test_an_appointment_is_filed_under_its_clinics_date(self, booked):
        """The whole reason clinicDay is computed in the clinic's timezone."""
        repository, _ids, made = booked
        stored = repository.get(
            keys.appointment(TENANT, made["etoa_after_midnight"]["appointmentId"])
        )
        assert stored["clinicDay"] == f"{DOUALA}#2026-03-03"

    def test_so_it_appears_on_that_dates_list_and_not_the_day_before(self, booked):
        _repository, _ids, made = booked
        monday = body_of(day("2026-03-02"))
        tuesday = body_of(day("2026-03-03"))
        late = made["etoa_after_midnight"]["appointmentId"]
        assert late not in {a["appointmentId"] for a in monday["appointments"]}
        assert late in {a["appointmentId"] for a in tuesday["appointments"]}


class TestCalendar:
    def test_fr_stf_01_a_clinician_sees_their_own_calendar(self, booked):
        _repository, ids, _made = booked
        result = get(
            "/clinicians/{id}/calendar",
            ids["etoa"],
            {"from": "2026-03-02", "to": "2026-03-03"},
            **as_clinician(ids["etoa"]),
        )
        assert result["statusCode"] == 200
        found = body_of(result)
        assert found["count"] == 3
        assert all(a["clinicianProfileId"] == ids["etoa"] for a in found["appointments"])

    def test_the_calendar_is_in_start_order(self, booked):
        _repository, ids, _made = booked
        found = body_of(
            get(
                "/clinicians/{id}/calendar",
                ids["etoa"],
                {"from": "2026-03-02", "to": "2026-03-03"},
                **as_clinician(ids["etoa"]),
            )
        )
        starts = [a["startAt"] for a in found["appointments"]]
        assert starts == sorted(starts)

    def test_the_range_is_the_clinics_dates(self, booked):
        """Monday alone in Douala excludes the 00:30 Tuesday appointment,
        though its UTC instant falls on Monday."""
        _repository, ids, made = booked
        found = body_of(
            get(
                "/clinicians/{id}/calendar",
                ids["etoa"],
                {"from": "2026-03-02", "to": "2026-03-02"},
                **as_clinician(ids["etoa"]),
            )
        )
        found_ids = {a["appointmentId"] for a in found["appointments"]}
        assert made["etoa_monday"]["appointmentId"] in found_ids
        assert made["etoa_after_midnight"]["appointmentId"] not in found_ids
        assert found["timezone"] == "Africa/Douala"

    def test_a_clinician_cannot_read_a_colleagues_calendar(self, booked):
        _repository, ids, _made = booked
        result = get("/clinicians/{id}/calendar", ids["abena"], **as_clinician(ids["etoa"]))
        assert result["statusCode"] == 403

    def test_fr_stf_01_a_receptionist_reads_any_clinician_in_their_clinic(self, booked):
        _repository, ids, _made = booked
        result = get(
            "/clinicians/{id}/calendar",
            ids["abena"],
            {"from": "2026-03-02", "to": "2026-03-02"},
            **as_receptionist(),
        )
        assert result["statusCode"] == 200
        assert body_of(result)["count"] == 1

    def test_a_clinic_manager_reads_them_too(self, booked):
        _repository, ids, _made = booked
        result = get(
            "/clinicians/{id}/calendar",
            ids["etoa"],
            roles="CLINIC_MANAGER",
            staffId="s-man",
            clinicId=DOUALA,
        )
        assert result["statusCode"] == 200

    def test_a_receptionist_cannot_read_another_clinics_clinician(self, booked):
        _repository, ids, _made = booked
        result = get("/clinicians/{id}/calendar", ids["manga"], **as_receptionist(DOUALA))
        assert result["statusCode"] == 403

    def test_a_patient_cannot_read_a_clinicians_calendar(self, booked):
        _repository, ids, _made = booked
        result = get(
            "/clinicians/{id}/calendar", ids["etoa"], roles="PATIENT", patientProfileId=PATIENT
        )
        assert result["statusCode"] == 403

    def test_a_non_clinician_staff_account_is_not_a_calendar(self, booked, repository):
        _repository, _ids, _made = booked
        repository.put(
            keys.staff_membership(TENANT, "s-rec"),
            {
                "type": "STAFF_MEMBERSHIP",
                "staffMembershipId": "s-rec",
                "tenantId": TENANT,
                "clinicId": DOUALA,
                "roles": ["RECEPTIONIST"],
                "status": "ACTIVE",
            },
        )
        assert get("/clinicians/{id}/calendar", "s-rec", **as_receptionist())["statusCode"] == 404

    def test_a_suspended_clinicians_calendar_is_still_readable(self, booked):
        """Suspension stops new bookings. The appointments already made still
        need someone to see and move them."""
        repository, ids, _made = booked
        People(repository).set_status(tenant_id=TENANT, staff_id=ids["etoa"], status="SUSPENDED")
        result = get(
            "/clinicians/{id}/calendar",
            ids["etoa"],
            {"from": "2026-03-02", "to": "2026-03-03"},
            **as_receptionist(),
        )
        assert result["statusCode"] == 200
        assert body_of(result)["count"] == 3

    def test_the_default_range_is_the_coming_week(self, booked):
        _repository, ids, _made = booked
        found = body_of(get("/clinicians/{id}/calendar", ids["etoa"], **as_clinician(ids["etoa"])))
        assert found["from"] == "2026-03-01"
        assert found["to"] == "2026-03-07"
        assert found["count"] == 3

    def test_a_range_wider_than_a_month_is_refused(self, booked):
        _repository, ids, _made = booked
        result = get(
            "/clinicians/{id}/calendar",
            ids["etoa"],
            {"from": "2026-03-01", "to": "2026-04-15"},
            **as_clinician(ids["etoa"]),
        )
        assert result["statusCode"] == 400

    def test_a_backwards_range_is_refused(self, booked):
        _repository, ids, _made = booked
        result = get(
            "/clinicians/{id}/calendar",
            ids["etoa"],
            {"from": "2026-03-05", "to": "2026-03-01"},
            **as_clinician(ids["etoa"]),
        )
        assert result["statusCode"] == 400

    def test_entries_carry_only_contract_fields(self, booked):
        _repository, ids, _made = booked
        found = body_of(get("/clinicians/{id}/calendar", ids["etoa"], **as_clinician(ids["etoa"])))
        for entry in found["appointments"]:
            assert set(entry) == set(views.VIEW_FIELDS)

    def test_a_cancelled_appointment_stays_on_the_calendar_with_its_state(self, booked):
        """A desk asking why a slot is empty wants to see the cancellation."""
        repository, ids, made = booked
        repository.update_existing(
            keys.appointment(TENANT, made["etoa_monday"]["appointmentId"]),
            set_values={"state": "PATIENT_CANCELLED"},
            what="appointment",
        )
        found = body_of(get("/clinicians/{id}/calendar", ids["etoa"], **as_clinician(ids["etoa"])))
        states = {a["appointmentId"]: a["state"] for a in found["appointments"]}
        assert states[made["etoa_monday"]["appointmentId"]] == "PATIENT_CANCELLED"


class TestClinicDay:
    def test_fr_stf_01_the_front_desk_sees_every_clinician_on_one_list(self, booked):
        _repository, ids, _made = booked
        found = body_of(day("2026-03-02"))
        assert found["count"] == 2
        assert {a["clinicianProfileId"] for a in found["appointments"]} == {
            ids["etoa"],
            ids["abena"],
        }

    def test_the_day_is_in_start_order(self, booked):
        _repository, _ids, _made = booked
        found = body_of(day("2026-03-02"))
        starts = [a["startAt"] for a in found["appointments"]]
        assert starts == sorted(starts)

    def test_a_clinician_cannot_read_the_whole_clinic_day(self, booked):
        """A clinician's scope is their own appointments, not their colleagues'."""
        _repository, ids, _made = booked
        result = get("/clinics/{id}/day", DOUALA, **as_clinician(ids["etoa"]))
        assert result["statusCode"] == 403

    def test_a_receptionist_cannot_read_another_clinics_day(self, booked):
        _repository, _ids, _made = booked
        assert get("/clinics/{id}/day", YAOUNDE, **as_receptionist(DOUALA))["statusCode"] == 403

    def test_an_administrator_reads_any_clinic_in_the_tenant(self, booked):
        _repository, _ids, _made = booked
        result = day("2026-03-02", YAOUNDE, roles="TENANT_ADMIN", staffId="s-adm")
        assert result["statusCode"] == 200

    def test_fr_stf_09_another_tenants_clinic_is_not_found(self, booked):
        _repository, _ids, _made = booked
        result = get("/clinics/{id}/day", DOUALA, **as_receptionist(), tenantId="t-other")
        assert result["statusCode"] == 404

    def test_fr_stf_09_a_clinic_with_the_same_id_in_another_tenant_stays_separate(
        self, booked, repository
    ):
        """The index partitions on clinic and date only; the tenant check is
        what keeps two tenants' same-named clinics apart."""
        repository.put(
            keys.tenant("t-other"),
            {"type": "TENANT", "tenantId": "t-other", "regionPackCode": "CM"},
        )
        repository.put(
            keys.clinic("t-other", DOUALA),
            {"type": "CLINIC", "clinicId": DOUALA, "tenantId": "t-other"},
        )
        found = body_of(
            get(
                "/clinics/{id}/day",
                DOUALA,
                {"date": "2026-03-02"},
                roles="RECEPTIONIST",
                staffId="s-other",
                clinicId=DOUALA,
                tenantId="t-other",
            )
        )
        assert found["count"] == 0

    def test_the_day_defaults_to_today_in_the_clinic(self, booked):
        _repository, _ids, _made = booked
        found = body_of(get("/clinics/{id}/day", DOUALA, **as_receptionist()))
        assert found["date"] == "2026-03-01"

    def test_a_malformed_date_is_refused(self, booked):
        _repository, _ids, _made = booked
        result = get("/clinics/{id}/day", DOUALA, {"date": "Monday"}, **as_receptionist())
        assert result["statusCode"] == 400


class TestPatientNames:
    """A list of identifiers is one nobody at a desk can use."""

    def name_the_patient(self, repository) -> None:
        repository.put(
            keys.person("p-ama"),
            {
                "type": "PERSON",
                "personId": "p-ama",
                "givenName": "Ama",
                "familyName": "Darko",
                "email": "ama@atria.invalid",
                "phoneE164": "+12025550140",
            },
        )
        repository.update_existing(
            keys.patient_profile(TENANT, PATIENT), set_values={"personId": "p-ama"}, what="patient"
        )

    def test_fr_stf_01_the_day_names_its_patients(self, booked):
        repository, _ids, _made = booked
        self.name_the_patient(repository)
        found = body_of(day("2026-03-02"))
        assert found["patients"] == {PATIENT: {"givenName": "Ama", "familyName": "Darko"}}

    def test_the_calendar_names_them_too(self, booked):
        repository, ids, _made = booked
        self.name_the_patient(repository)
        found = body_of(get("/clinicians/{id}/calendar", ids["etoa"], **as_clinician(ids["etoa"])))
        assert found["patients"][PATIENT]["givenName"] == "Ama"

    def test_names_only_and_no_contact_details(self, booked):
        repository, _ids, _made = booked
        self.name_the_patient(repository)
        text = json.dumps(body_of(day("2026-03-02"))["patients"])
        assert "ama@atria.invalid" not in text
        assert "5550140" not in text

    def test_a_patient_with_no_name_on_record_is_still_listed(self, booked):
        """So the client never meets an appointment it cannot label."""
        found = body_of(day("2026-03-02"))
        assert found["patients"] == {PATIENT: {"givenName": None, "familyName": None}}

    def test_an_empty_day_names_nobody(self, booked):
        assert body_of(day("2026-03-05"))["patients"] == {}
