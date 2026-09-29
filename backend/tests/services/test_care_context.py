"""Intake answers as care context (FR-BKG-15, FR-PRV-10, acceptance AD-06).

Verifies that a type's intake form is asked at booking and its answers are
stored apart from the appointment with a CARE_CONTEXT consent; that only the
patient and the assigned clinician read them, and the front desk, the unit
manager and the administrator are refused; that answers are checked against
the form; and that they can be changed until the visit starts.
"""

from __future__ import annotations

import datetime as dt
import json

import boto3
import pytest

from atria.core import intake as rules
from atria.core.errors import Invalid
from atria.data import keys
from atria.data.booking import Booking
from atria.data.intake import CareContexts, IntakeForms
from atria.data.repository import Repository
from atria.services.booking import appointments as service
from atria.services.booking import care

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
CLINIC = "c-douala-01"
CLINICIAN = "s-clin-1"
OTHER_CLINICIAN = "s-clin-2"
PATIENT = "pp-1"
PERSON = "p-1"

NOW = dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
START = "2026-03-04T08:00:00Z"

FORM = {
    "name": "First specialist visit",
    "fields": [
        {
            "id": "reason",
            "kind": "longText",
            "label": "What brings you?",
            "required": True,
            "max": 300,
        },
        {
            "id": "since",
            "kind": "choice",
            "label": "Since when?",
            "options": [{"id": "days", "label": "Days"}, {"id": "weeks", "label": "Weeks"}],
        },
        {"id": "allergies", "kind": "yesNo", "label": "Allergies?"},
        {"id": "weeks", "kind": "number", "label": "Weeks?", "min": 1, "max": 45},
    ],
}

ANSWERS = {"reason": "A cough that will not go", "since": "weeks", "allergies": False}


@pytest.fixture
def wired(monkeypatch, repository):
    monkeypatch.setattr(service, "_booking", Booking(repository, clock=lambda: NOW))
    dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
    care_table = dynamodb.create_table(
        TableName="atria-test-care",
        KeySchema=[
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    store = CareContexts(Repository(table=care_table), clock=lambda: NOW)
    care.use(store)
    form = IntakeForms(repository, clock=lambda: NOW).publish(
        TENANT, rules.form_fields(FORM), form_id=None, by="p-admin"
    )
    repository.put(
        keys.tenant(TENANT), {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10}
    )
    repository.put(
        keys.appointment_type(TENANT, "at-spec-first"),
        {
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
            "intakeFormId": form["intakeFormId"],
        },
    )
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {
            "type": "PATIENT_PROFILE",
            "patientProfileId": PATIENT,
            "tenantId": TENANT,
            "personId": PERSON,
        },
    )
    for staff_id in (CLINICIAN, OTHER_CLINICIAN):
        repository.put(
            keys.staff_membership(TENANT, staff_id),
            {
                "type": "STAFF_MEMBERSHIP",
                "staffMembershipId": staff_id,
                "personId": f"p-{staff_id}",
                "tenantId": TENANT,
                "clinicId": CLINIC,
                "roles": ["CLINICIAN"],
                "status": "ACTIVE",
            },
        )
    yield repository, store, form
    care.use(None)


def request(
    method: str, resource: str, body: object = None, *, path_id: str | None = None, **who: str
):
    context = {
        "personId": PERSON,
        "tenantId": TENANT,
        "roles": "PATIENT",
        "patientProfileId": PATIENT,
    }
    context.update(who)
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": {"id": path_id} if path_id else None,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": context},
    }


def book(intake: object = None):
    body = {"appointmentTypeId": "at-spec-first", "clinicianProfileId": CLINICIAN, "startAt": START}
    if intake is not None:
        body["intake"] = intake
    return service.handler(request("POST", "/appointments", body), None)


def body_of(result):
    return json.loads(str(result["body"]))


def read(appointment_id: str, **who: str):
    return service.handler(
        request("GET", "/appointments/{id}/care-context", path_id=appointment_id, **who), None
    )


STAFF = {
    "clinician": {
        "personId": "p-s-clin-1",
        "roles": "CLINICIAN",
        "staffId": CLINICIAN,
        "clinicId": CLINIC,
        "patientProfileId": "",
    },
    "other clinician": {
        "personId": "p-s-clin-2",
        "roles": "CLINICIAN",
        "staffId": OTHER_CLINICIAN,
        "clinicId": CLINIC,
        "patientProfileId": "",
    },
    "front desk": {
        "personId": "p-desk",
        "roles": "RECEPTIONIST",
        "staffId": "s-desk",
        "clinicId": CLINIC,
        "patientProfileId": "",
    },
    "unit manager": {
        "personId": "p-man",
        "roles": "CLINIC_MANAGER",
        "staffId": "s-man",
        "clinicId": CLINIC,
        "patientProfileId": "",
    },
    "administrator": {
        "personId": "p-admin",
        "roles": "TENANT_ADMIN",
        "staffId": "s-admin",
        "patientProfileId": "",
    },
}


class TestBookingWithAnswers:
    def test_fr_bkg_15_answers_given_at_booking_are_kept_as_care_context(self, wired):
        _repository, store, form = wired
        booked = body_of(book({"answers": ANSWERS, "consent": True}))
        assert booked["careContext"] == "SAVED"
        held = store.get(TENANT, booked["appointmentId"])
        assert held["answers"] == ANSWERS
        assert held["intakeFormId"] == form["intakeFormId"]
        assert held["formVersion"] == 1

    def test_the_answers_are_not_on_the_appointment(self, wired):
        repository, _store, _form = wired
        booked = body_of(book({"answers": ANSWERS, "consent": True}))
        appointment = repository.get(keys.appointment(TENANT, booked["appointmentId"]))
        assert "answers" not in appointment
        assert "A cough" not in json.dumps(appointment, default=str)

    def test_a_consent_record_is_written_for_care_context(self, wired):
        repository, _store, _form = wired
        book({"answers": ANSWERS, "consent": True})
        consents = repository.query_partition(f"PERSON#{PERSON}", sk_prefix="CONSENT#")
        assert [c["purpose"] for c in consents] == ["CARE_CONTEXT"]

    def test_answers_without_consent_are_refused_and_nothing_is_booked(self, wired):
        repository, _store, _form = wired
        result = book({"answers": ANSWERS})
        assert result["statusCode"] == 400
        assert repository.query_index("PatientIndex", "patientProfileId", PATIENT) == []

    def test_a_needed_answer_left_out_is_refused_before_any_time_is_held(self, wired):
        repository, _store, _form = wired
        result = book({"answers": {"since": "days"}, "consent": True})
        assert result["statusCode"] == 400
        assert "What brings you" in body_of(result)["message"]
        assert repository.query_index("PatientIndex", "patientProfileId", PATIENT) == []

    def test_booking_without_answers_is_still_a_booking(self, wired):
        _repository, store, _form = wired
        booked = body_of(book())
        assert booked["state"] == "BOOKED"
        assert store.get(TENANT, booked["appointmentId"]) is None


class TestWhoReads:
    def test_the_patient_reads_their_answers(self, wired):
        booked = body_of(book({"answers": ANSWERS, "consent": True}))
        seen = body_of(read(booked["appointmentId"]))
        assert seen["answers"] == ANSWERS
        assert seen["form"]["fields"][0]["id"] == "reason"
        assert seen["editable"] is True

    def test_the_assigned_clinician_reads_them(self, wired):
        booked = body_of(book({"answers": ANSWERS, "consent": True}))
        result = read(booked["appointmentId"], **STAFF["clinician"])
        assert result["statusCode"] == 200
        assert body_of(result)["answers"] == ANSWERS
        assert body_of(result)["editable"] is False

    @pytest.mark.parametrize(
        "who", ["other clinician", "front desk", "unit manager", "administrator"]
    )
    def test_ad_06_everyone_else_is_refused(self, wired, who):
        booked = body_of(book({"answers": ANSWERS, "consent": True}))
        assert read(booked["appointmentId"], **STAFF[who])["statusCode"] == 403

    def test_the_desk_cannot_send_answers_with_a_booking(self, wired):
        body = {
            "patientProfileId": PATIENT,
            "appointmentTypeId": "at-spec-first",
            "clinicianProfileId": CLINICIAN,
            "startAt": START,
            "channel": "WALK_IN",
            "intake": {"answers": ANSWERS, "consent": True},
        }
        result = service.handler(
            request("POST", "/appointments", body, **STAFF["front desk"]), None
        )
        assert result["statusCode"] == 403


class TestChangingAnswers:
    def test_the_patient_adds_answers_after_booking(self, wired):
        _repository, store, _form = wired
        booked = body_of(book())
        result = service.handler(
            request(
                "PUT",
                "/appointments/{id}/care-context",
                {"answers": {"reason": "Headaches"}, "consent": True},
                path_id=booked["appointmentId"],
            ),
            None,
        )
        assert result["statusCode"] == 200
        assert store.get(TENANT, booked["appointmentId"])["answers"] == {"reason": "Headaches"}

    def test_the_clinician_cannot_write_the_patients_answers(self, wired):
        booked = body_of(book())
        result = service.handler(
            request(
                "PUT",
                "/appointments/{id}/care-context",
                {"answers": {"reason": "x"}, "consent": True},
                path_id=booked["appointmentId"],
                **STAFF["clinician"],
            ),
            None,
        )
        assert result["statusCode"] == 403

    def test_answers_go_ninety_days_after_the_visit(self, wired):
        _repository, store, _form = wired
        booked = body_of(book({"answers": ANSWERS, "consent": True}))
        held = store.get(TENANT, booked["appointmentId"])
        end = dt.datetime.fromisoformat(booked["endAt"].replace("Z", "+00:00"))
        assert int(held["expiresAt"]) == int((end + dt.timedelta(days=90)).timestamp())


class TestTheRules:
    def test_a_choice_must_be_an_option(self):
        with pytest.raises(Invalid):
            rules.answers(rules.form_fields(FORM), {"reason": "x", "since": "years"})

    def test_a_number_must_be_in_range(self):
        with pytest.raises(Invalid):
            rules.answers(rules.form_fields(FORM), {"reason": "x", "weeks": 60})

    def test_an_answer_to_a_question_not_asked_is_refused(self):
        with pytest.raises(Invalid):
            rules.answers(rules.form_fields(FORM), {"reason": "x", "hiv": True})

    def test_empty_answers_are_left_out(self):
        assert rules.answers(rules.form_fields(FORM), {"reason": "x", "since": ""}) == {
            "reason": "x"
        }

    def test_a_form_without_questions_is_refused(self):
        with pytest.raises(Invalid):
            rules.form_fields({"name": "Empty", "fields": []})
