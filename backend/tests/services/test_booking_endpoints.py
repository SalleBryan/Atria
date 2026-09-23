"""POST /appointments, from the token to the locked units.

Verifies FR-BKG-01 (a patient books a clinician, a date and a free start and is
given a reference), FR-BKG-02 (a taken unit is a 409 and nothing is written),
FR-BKG-05 (the type's notice and window apply) and FR-BKG-07 (staff book on
behalf of a patient and the booking is attributed to the staff account).

Guard SELF_SUBJECT_DROPS_STAFF_SCOPE is verified here: a staff member booking
for their own patient profile is handled as a patient, so a staff only type is
refused to them.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from atria.data import keys
from atria.data.booking import Booking
from atria.http import views
from atria.services.booking import appointments as service

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
CLINIC = "c-douala-01"
OTHER_CLINIC = "c-yaounde-01"
CLINICIAN = "s-clin-1"
PATIENT = "pp-1"

NOW = dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
START = "2026-03-04T08:00:00Z"

BODY = {
    "patientProfileId": PATIENT,
    "appointmentTypeId": "at-spec-first",
    "clinicianProfileId": CLINICIAN,
    "startAt": START,
}

SPECIALIST_TYPE = {
    "type": "APPOINTMENT_TYPE",
    "appointmentTypeId": "at-spec-first",
    "tenantId": TENANT,
    "serviceLine": "SPECIALIST",
    "durationUnits": 3,
    "bufferUnits": 1,
    "bookableBy": "BOTH",
    "minNoticeMinutes": 30,
    "maxAdvanceDays": 60,
    "active": True,
}

PROCEDURE_TYPE = {
    **SPECIALIST_TYPE,
    "appointmentTypeId": "at-minor-proc",
    "serviceLine": "PROCEDURE",
    "bookableBy": "STAFF",
}


@pytest.fixture
def wired(monkeypatch, repository):
    """Point the service at the moto table and a fixed clock."""
    monkeypatch.setattr(service, "_booking", Booking(repository, clock=lambda: NOW))

    repository.put(
        keys.tenant(TENANT), {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10}
    )
    repository.put(keys.appointment_type(TENANT, "at-spec-first"), SPECIALIST_TYPE)
    repository.put(keys.appointment_type(TENANT, "at-minor-proc"), PROCEDURE_TYPE)
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {"type": "PATIENT_PROFILE", "patientProfileId": PATIENT, "tenantId": TENANT},
    )
    membership(repository, CLINICIAN, roles=["CLINICIAN"], clinic_id=CLINIC)
    return repository


def membership(repository, staff_id, *, roles, clinic_id, status="ACTIVE"):
    return repository.put(
        keys.staff_membership(TENANT, staff_id),
        {
            "type": "STAFF_MEMBERSHIP",
            "staffMembershipId": staff_id,
            "personId": f"p-{staff_id}",
            "tenantId": TENANT,
            "clinicId": clinic_id,
            "roles": roles,
            "status": status,
        },
    )


def event(body: object = BODY, **context: str) -> dict[str, object]:
    base = {"personId": "p-1", "tenantId": TENANT, "roles": "PATIENT"}
    base.update(context)
    return {
        "httpMethod": "POST",
        "resource": "/appointments",
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": base},
    }


def patient_event(body: object = BODY, **context: str) -> dict[str, object]:
    return event(body, patientProfileId=PATIENT, **context)


def receptionist_event(body: object = BODY, **context: str) -> dict[str, object]:
    defaults = {"roles": "RECEPTIONIST", "staffId": "s-rec-1", "clinicId": CLINIC}
    defaults.update(context)
    return event(body, **defaults)


def body_of(result: dict[str, object]) -> dict[str, object]:
    return json.loads(str(result["body"]))


class TestPatientBooking:
    def test_fr_bkg_01_a_patient_books_and_is_given_a_reference(self, wired):
        result = service.handler(patient_event(), None)
        assert result["statusCode"] == 201
        booked = body_of(result)
        assert booked["state"] == "BOOKED"
        assert booked["startAt"] == START
        assert booked["endAt"] == "2026-03-04T08:30:00Z"
        assert str(booked["reference"]).startswith("APT-")

    def test_the_clinic_comes_from_the_clinician_not_the_request(self, wired):
        """A caller supplied clinic would place the booking outside its own clinic."""
        result = service.handler(patient_event({**BODY, "clinicId": OTHER_CLINIC}), None)
        assert result["statusCode"] == 400

    def test_the_response_carries_only_what_the_contract_describes(self, wired):
        """The stored record also holds storage fields, which are not the contract."""
        booked = body_of(service.handler(patient_event(), None))
        assert set(booked) == set(views.VIEW_FIELDS)
        assert "type" not in booked
        assert "pk" not in booked

    def test_every_instant_on_the_wire_has_one_format(self, wired):
        booked = body_of(service.handler(patient_event(), None))
        for field in ("startAt", "endAt", "createdAt"):
            assert str(booked[field]).endswith("Z"), field

    def test_a_patient_booking_is_self_service(self, wired):
        booked = body_of(service.handler(patient_event(), None))
        assert booked["bookedByRole"] is None
        assert booked["patientProfileId"] == PATIENT

    def test_a_patient_cannot_book_for_somebody_else(self, wired):
        body = {**BODY, "patientProfileId": "pp-somebody-else"}
        booked = body_of(service.handler(patient_event(body), None))
        assert booked["patientProfileId"] == PATIENT

    def test_a_patient_cannot_book_a_staff_only_type(self, wired):
        """ADR 0005: a procedure is sized and placed by staff."""
        body = {**BODY, "appointmentTypeId": "at-minor-proc"}
        assert service.handler(patient_event(body), None)["statusCode"] == 400

    def test_an_account_with_no_patient_profile_cannot_book(self, wired):
        assert service.handler(event(), None)["statusCode"] == 400


class TestStaffBooking:
    def test_fr_bkg_07_a_receptionist_books_for_a_patient(self, wired):
        result = service.handler(receptionist_event(), None)
        assert result["statusCode"] == 201
        booked = body_of(result)
        assert booked["patientProfileId"] == PATIENT
        assert booked["bookedByRole"] == "RECEPTIONIST"
        assert booked["bookedByPersonId"] == "p-1"

    def test_a_receptionist_must_name_the_patient(self, wired):
        body = {k: v for k, v in BODY.items() if k != "patientProfileId"}
        assert service.handler(receptionist_event(body), None)["statusCode"] == 400

    def test_a_receptionist_cannot_book_into_another_clinic(self, wired):
        """The clinician's clinic decides, and clinic scope refuses the rest."""
        result = service.handler(receptionist_event(clinicId=OTHER_CLINIC), None)
        assert result["statusCode"] == 403

    def test_a_tenant_administrator_does_not_book(self, wired):
        """The matrix grants appointment.create to no administrator."""
        result = service.handler(receptionist_event(roles="TENANT_ADMIN", clinicId=CLINIC), None)
        assert result["statusCode"] == 403

    def test_a_receptionist_books_a_staff_only_type(self, wired):
        body = {**BODY, "appointmentTypeId": "at-minor-proc"}
        assert service.handler(receptionist_event(body), None)["statusCode"] == 201

    def test_staff_booking_for_themselves_is_treated_as_a_patient(self, wired):
        """Guard SELF_SUBJECT_DROPS_STAFF_SCOPE: no staff tooling on one's own record."""
        body = {**BODY, "appointmentTypeId": "at-minor-proc"}
        result = service.handler(receptionist_event(body, patientProfileId=PATIENT), None)
        assert result["statusCode"] == 400

    def test_staff_booking_for_themselves_records_no_staff_role(self, wired):
        result = service.handler(receptionist_event(BODY, patientProfileId=PATIENT), None)
        assert result["statusCode"] == 201
        assert body_of(result)["bookedByRole"] is None


class TestRefusals:
    def test_fr_bkg_02_a_taken_time_is_a_conflict(self, wired):
        assert service.handler(patient_event(), None)["statusCode"] == 201
        second = service.handler(patient_event(), None)
        assert second["statusCode"] == 409
        assert body_of(second)["code"] == "conflict"

    def test_fr_bkg_05_a_start_inside_the_notice_period_is_refused(self, wired):
        body = {**BODY, "startAt": "2026-03-04T07:10:00Z"}
        result = service.handler(patient_event(body), None)
        assert result["statusCode"] == 400
        assert body_of(result)["detail"]["minNoticeMinutes"] == 30

    def test_fr_bkg_05_a_start_beyond_the_booking_window_is_refused(self, wired):
        body = {**BODY, "startAt": "2027-03-04T08:00:00Z"}
        assert service.handler(patient_event(body), None)["statusCode"] == 400

    def test_a_start_off_the_grid_is_refused(self, wired):
        body = {**BODY, "startAt": "2026-03-04T08:05:00Z"}
        result = service.handler(patient_event(body), None)
        assert result["statusCode"] == 400
        assert body_of(result)["detail"]["gridUnitMinutes"] == 10

    def test_an_unknown_clinician_is_not_found(self, wired):
        body = {**BODY, "clinicianProfileId": "s-nobody"}
        assert service.handler(patient_event(body), None)["statusCode"] == 404

    def test_an_unknown_patient_is_not_found(self, wired):
        body = {**BODY, "patientProfileId": "pp-nobody"}
        assert service.handler(receptionist_event(body), None)["statusCode"] == 404

    def test_an_unknown_appointment_type_is_not_found(self, wired):
        body = {**BODY, "appointmentTypeId": "at-nope"}
        assert service.handler(patient_event(body), None)["statusCode"] == 404

    def test_a_suspended_clinician_takes_no_appointments(self, wired, repository):
        membership(repository, CLINICIAN, roles=["CLINICIAN"], clinic_id=CLINIC, status="SUSPENDED")
        assert service.handler(patient_event(), None)["statusCode"] == 409

    def test_a_receptionist_is_not_a_clinician(self, wired, repository):
        membership(repository, "s-rec-9", roles=["RECEPTIONIST"], clinic_id=CLINIC)
        body = {**BODY, "clinicianProfileId": "s-rec-9"}
        assert service.handler(patient_event(body), None)["statusCode"] == 400

    def test_a_server_derived_field_is_rejected(self, wired):
        """Guard SERVER_ASSIGNED_ORDER."""
        result = service.handler(patient_event({**BODY, "state": "CONFIRMED"}), None)
        assert result["statusCode"] == 400
        assert "state" in body_of(result)["detail"]["fields"]

    def test_no_body_is_a_400(self, wired):
        assert service.handler(patient_event(None), None)["statusCode"] == 400

    def test_a_request_with_no_caller_is_unauthenticated(self, wired):
        stripped = patient_event()
        stripped["requestContext"] = {}
        assert service.handler(stripped, None)["statusCode"] == 401
