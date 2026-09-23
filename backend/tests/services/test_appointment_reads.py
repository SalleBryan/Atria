"""Reading appointments back, and only the ones the caller may see.

Verifies FR-VIS-01 (a patient lists their own appointments, upcoming and past,
ordered by start time), FR-VIS-02 (a patient or staff member opens one
appointment within their scope) and FR-ACC-09 (a patient reads only their own).

The four range views are Phase 2, so what is tested here is the question a
patient starts with: what is coming up, and what already happened.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from atria.core import booking as rules
from atria.data import keys
from atria.data.booking import Booking
from atria.services.booking import appointments as service

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
YAOUNDE = "c-yaounde-01"
MINE = "pp-mine"
THEIRS = "pp-theirs"
CLINICIAN = "s-clin-1"

NOW = dt.datetime(2026, 3, 4, 12, 0, tzinfo=dt.UTC)


@pytest.fixture
def wired(monkeypatch, repository):
    monkeypatch.setattr(service, "_booking", Booking(repository, clock=lambda: NOW))
    return repository


def put_appointment(
    repository,
    appointment_id: str,
    *,
    patient: str = MINE,
    start: dt.datetime,
    clinic_id: str = DOUALA,
    clinician: str = CLINICIAN,
    state: str = "BOOKED",
):
    occupancy = rules.occupancy(start, duration_units=3, buffer_units=0, minutes=10)
    return repository.put(
        keys.appointment(TENANT, appointment_id),
        {
            "type": "APPOINTMENT",
            "appointmentId": appointment_id,
            "reference": f"APT-{appointment_id.upper()}",
            "tenantId": TENANT,
            "clinicId": clinic_id,
            "patientProfileId": patient,
            "appointmentTypeId": "at-spec-first",
            "clinicianProfileId": clinician,
            "sessionId": None,
            "startAt": rules.instant(occupancy.start_at),
            "endAt": rules.instant(occupancy.end_at),
            "state": state,
            "channel": "ONLINE",
            "bookedByPersonId": "p-1",
            "bookedByRole": None,
            "version": 1,
        },
    )


@pytest.fixture
def seeded(wired):
    """Two of mine, one in the past, and one that is somebody else's."""
    put_appointment(wired, "a-past", start=NOW - dt.timedelta(days=30))
    put_appointment(wired, "a-soon", start=NOW + dt.timedelta(days=2))
    put_appointment(wired, "a-later", start=NOW + dt.timedelta(days=9))
    put_appointment(wired, "a-theirs", patient=THEIRS, start=NOW + dt.timedelta(days=3))
    return wired


def event(resource: str, *, path=None, query=None, **context):
    base = {
        "personId": "p-1",
        "tenantId": TENANT,
        "roles": "PATIENT",
        "patientProfileId": MINE,
    }
    base.update(context)
    return {
        "httpMethod": "GET",
        "resource": resource,
        "pathParameters": path,
        "queryStringParameters": query,
        "requestContext": {"authorizer": base},
    }


def body_of(result) -> dict:
    return json.loads(str(result["body"]))


def mine(**kwargs):
    return service.handler(event("/patients/me/appointments", **kwargs), None)


class TestMyAppointments:
    def test_a_patient_sees_their_own_appointments(self, seeded):
        result = mine()
        assert result["statusCode"] == 200
        found = body_of(result)
        assert found["count"] == 3

    def test_somebody_elses_appointment_is_not_included(self, seeded):
        found = body_of(mine())
        assert all(a["patientProfileId"] == MINE for a in found["appointments"])

    def test_they_are_ordered_by_start_time(self, seeded):
        found = body_of(mine())
        starts = [a["startAt"] for a in found["appointments"]]
        assert starts == sorted(starts)

    def test_upcoming_leaves_out_the_past(self, seeded):
        found = body_of(mine(query={"when": "upcoming"}))
        assert {a["appointmentId"] for a in found["appointments"]} == {"a-soon", "a-later"}

    def test_past_leaves_out_what_is_coming(self, seeded):
        found = body_of(mine(query={"when": "past"}))
        assert {a["appointmentId"] for a in found["appointments"]} == {"a-past"}

    def test_the_window_it_used_is_reported(self, seeded):
        found = body_of(mine(query={"when": "upcoming"}))
        assert found["from"] == rules.instant(NOW)
        assert found["when"] == "upcoming"

    def test_an_unknown_when_is_refused(self, seeded):
        result = mine(query={"when": "someday"})
        assert result["statusCode"] == 400
        assert "upcoming" in body_of(result)["detail"]["allowed"]

    def test_an_account_with_no_patient_profile_is_refused(self, seeded):
        result = service.handler(
            {
                "httpMethod": "GET",
                "resource": "/patients/me/appointments",
                "requestContext": {
                    "authorizer": {
                        "personId": "p-9",
                        "tenantId": TENANT,
                        "roles": "RECEPTIONIST",
                        "staffId": "s-rec-1",
                        "clinicId": DOUALA,
                    }
                },
            },
            None,
        )
        assert result["statusCode"] == 400

    def test_a_token_naming_another_tenant_sees_nothing(self, seeded):
        """FR-TEN-01. The index is keyed on the patient profile alone, so the
        tenant is checked rather than assumed from identifiers being random."""
        found = body_of(mine(tenantId="t-other"))
        assert found["count"] == 0

    def test_the_listing_carries_only_contract_fields(self, seeded):
        for entry in body_of(mine())["appointments"]:
            assert set(entry) == set(service.VIEW_FIELDS)


class TestOneAppointment:
    def one(self, appointment_id: str, **context):
        return service.handler(
            event("/appointments/{id}", path={"id": appointment_id}, **context), None
        )

    def test_a_patient_opens_their_own(self, seeded):
        result = self.one("a-soon")
        assert result["statusCode"] == 200
        assert body_of(result)["appointmentId"] == "a-soon"

    def test_a_patient_cannot_open_somebody_elses(self, seeded):
        assert self.one("a-theirs")["statusCode"] == 403

    def test_a_receptionist_opens_one_in_their_clinic(self, seeded):
        result = self.one(
            "a-theirs",
            roles="RECEPTIONIST",
            staffId="s-rec-1",
            clinicId=DOUALA,
            patientProfileId="",
        )
        assert result["statusCode"] == 200

    def test_a_receptionist_cannot_open_one_in_another_clinic(self, seeded, wired):
        put_appointment(
            wired, "a-elsewhere", patient=THEIRS, start=NOW + dt.timedelta(days=4),
            clinic_id=YAOUNDE,
        )
        result = self.one(
            "a-elsewhere",
            roles="RECEPTIONIST",
            staffId="s-rec-1",
            clinicId=DOUALA,
            patientProfileId="",
        )
        assert result["statusCode"] == 403

    def test_a_clinician_opens_their_own_appointment(self, seeded):
        result = self.one(
            "a-theirs",
            roles="CLINICIAN",
            staffId=CLINICIAN,
            clinicId=DOUALA,
            patientProfileId="",
        )
        assert result["statusCode"] == 200

    def test_a_clinician_cannot_open_another_clinicians(self, seeded, wired):
        put_appointment(
            wired, "a-other-clin", patient=THEIRS, start=NOW + dt.timedelta(days=5),
            clinician="s-clin-2",
        )
        result = self.one(
            "a-other-clin",
            roles="CLINICIAN",
            staffId=CLINICIAN,
            clinicId=DOUALA,
            patientProfileId="",
        )
        assert result["statusCode"] == 403

    def test_staff_opening_their_own_record_is_treated_as_a_patient(self, seeded):
        """Guard SELF_SUBJECT_DROPS_STAFF_SCOPE: it is still readable, as theirs."""
        result = self.one(
            "a-soon",
            roles="RECEPTIONIST",
            staffId="s-rec-1",
            clinicId=YAOUNDE,
            patientProfileId=MINE,
        )
        assert result["statusCode"] == 200

    def test_an_unknown_appointment_is_not_found(self, seeded):
        assert self.one("a-nope")["statusCode"] == 404

    def test_an_appointment_in_another_tenant_is_not_found(self, seeded):
        assert self.one("a-soon", tenantId="t-other")["statusCode"] == 404
