"""A retried booking gets the original answer, not a second appointment.

Verifies FR-BKG-04: a booking request carries an Idempotency-Key, and a
repeated request with the same key within 24 hours returns the original result.

The slot locks already stop a retry becoming a second appointment. What this
adds is the difference between a patient being told their booking failed and
being shown the booking they already have.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from atria.core import staff as staff_rules
from atria.data import keys
from atria.data.booking import Booking
from atria.data.idempotency import COMPLETED, IN_PROGRESS, Idempotency, fingerprint
from atria.data.people import People
from atria.services.booking import appointments as service

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
PATIENT = "pp-1"
TYPE_ID = "at-spec-first"

NOW = dt.datetime(2026, 3, 1, 9, 0, tzinfo=dt.UTC)
START = "2026-03-04T08:00:00Z"
KEY = "idem-0123456789abcdef"


@pytest.fixture
def wired(monkeypatch, repository):
    monkeypatch.setattr(service, "_booking", Booking(repository, clock=lambda: NOW))
    monkeypatch.setattr(service, "_idempotency", Idempotency(repository, clock=lambda: NOW))

    repository.put(
        keys.tenant(TENANT), {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10}
    )
    repository.put(
        keys.appointment_type(TENANT, TYPE_ID),
        {
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": TYPE_ID,
            "tenantId": TENANT,
            "durationUnits": 3,
            "bufferUnits": 1,
            "bookableBy": "BOTH",
            "minNoticeMinutes": 30,
            "maxAdvanceDays": 60,
            "active": True,
        },
    )
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {"type": "PATIENT_PROFILE", "patientProfileId": PATIENT, "tenantId": TENANT},
    )
    _person, membership = People(repository).create_staff_account(
        tenant_id=TENANT,
        account=staff_rules.StaffAccount(
            given_name="Paul",
            family_name="Etoa",
            phone_e164="+237600000010",
            roles=("CLINICIAN",),
            clinic_id=DOUALA,
            specialty="Paediatrics",
            registration_year=2012,
            ordre_number="CM-ONMC-1",
            languages=("fr",),
        ),
    )
    return repository, membership["staffMembershipId"]


def post(clinician_id: str, *, key: str | None = KEY, start: str = START, headers=None):
    sent = dict(headers) if headers is not None else {}
    if key is not None and headers is None:
        sent["Idempotency-Key"] = key
    return service.handler(
        {
            "httpMethod": "POST",
            "resource": "/appointments",
            "headers": sent,
            "body": json.dumps(
                {
                    "appointmentTypeId": TYPE_ID,
                    "clinicianProfileId": clinician_id,
                    "startAt": start,
                }
            ),
            "requestContext": {
                "authorizer": {
                    "personId": "p-1",
                    "tenantId": TENANT,
                    "roles": "PATIENT",
                    "patientProfileId": PATIENT,
                }
            },
        },
        None,
    )


def body_of(result) -> dict:
    return json.loads(str(result["body"]))


class TestReplay:
    def test_fr_bkg_04_a_repeat_returns_the_original_appointment(self, wired):
        _repo, clinician = wired
        first = post(clinician)
        assert first["statusCode"] == 201
        second = post(clinician)
        assert second["statusCode"] == 201
        assert body_of(second) == body_of(first)

    def test_the_repeat_is_marked_as_a_replay(self, wired):
        _repo, clinician = wired
        post(clinician)
        second = post(clinician)
        assert second["headers"]["Idempotency-Replayed"] == "true"

    def test_the_first_answer_is_not_marked_as_a_replay(self, wired):
        _repo, clinician = wired
        assert "Idempotency-Replayed" not in post(wired[1])["headers"]

    def test_only_one_appointment_exists_afterwards(self, wired, repository):
        _repo, clinician = wired
        post(clinician)
        post(clinician)
        booked = repository.query_index("PatientIndex", "patientProfileId", PATIENT)
        assert len(booked) == 1

    def test_a_repeat_does_not_take_a_second_set_of_locks(self, wired, repository):
        _repo, clinician = wired
        first = body_of(post(clinician))
        post(clinician)
        lock = repository.get(keys.slot_lock(TENANT, clinician, START))
        assert lock is not None
        assert lock["appointmentId"] == first["appointmentId"]

    def test_the_header_is_read_whatever_case_it_arrives_in(self, wired):
        _repo, clinician = wired
        first = post(clinician, headers={"idempotency-key": KEY})
        second = post(clinician, headers={"IDEMPOTENCY-KEY": KEY})
        assert body_of(second) == body_of(first)


class TestWithoutAKey:
    def test_a_booking_without_a_key_still_works(self, wired):
        _repo, clinician = wired
        assert post(clinician, headers={})["statusCode"] == 201

    def test_a_repeat_without_a_key_is_refused_by_the_locks(self, wired):
        """Which is the behaviour the key exists to soften, not replace."""
        _repo, clinician = wired
        assert post(clinician, headers={})["statusCode"] == 201
        assert post(clinician, headers={})["statusCode"] == 409


class TestMisuse:
    def test_the_same_key_for_a_different_booking_is_refused(self, wired):
        """Answering with the earlier appointment would be worse than refusing."""
        _repo, clinician = wired
        assert post(clinician)["statusCode"] == 201
        different = post(clinician, start="2026-03-04T09:00:00Z")
        assert different["statusCode"] == 409
        assert "different request" in body_of(different)["message"]

    def test_a_key_still_in_progress_is_refused(self, wired, repository):
        """A half finished booking is not an answer."""
        _repo, clinician = wired
        repository.put(
            keys.idempotency(TENANT, KEY),
            {
                "type": "IDEMPOTENCY",
                "tenantId": TENANT,
                "idempotencyKey": KEY,
                "fingerprint": fingerprint(
                    {
                        "appointmentTypeId": TYPE_ID,
                        "clinicianProfileId": clinician,
                        "startAt": START,
                    }
                ),
                "status": IN_PROGRESS,
            },
        )
        result = post(clinician)
        assert result["statusCode"] == 409
        assert "still being processed" in body_of(result)["message"]

    @pytest.mark.parametrize("key", ["short", "", " " * 12])
    def test_a_key_that_is_too_short_is_refused(self, wired, key):
        _repo, clinician = wired
        assert post(clinician, headers={"Idempotency-Key": key})["statusCode"] == 400

    def test_a_key_that_is_too_long_is_refused(self, wired):
        _repo, clinician = wired
        result = post(clinician, headers={"Idempotency-Key": "x" * 201})
        assert result["statusCode"] == 400


class TestFailure:
    def test_a_failed_booking_gives_the_key_back(self, wired, repository):
        """Otherwise a failure for some other reason would lock the client out
        of retrying for a day."""
        _repo, clinician = wired
        refused = post(clinician, start="2026-03-04T08:05:00Z")
        assert refused["statusCode"] == 400
        assert repository.get(keys.idempotency(TENANT, KEY)) is None

        # And the same key now works for a corrected request.
        assert post(clinician)["statusCode"] == 201


class TestRecord:
    def test_the_record_expires_after_a_day(self, wired, repository):
        _repo, clinician = wired
        post(clinician)
        held = repository.get(keys.idempotency(TENANT, KEY))
        assert held is not None
        assert held["status"] == COMPLETED
        assert int(held["expiresAt"]) == int((NOW + dt.timedelta(hours=24)).timestamp())

    def test_the_record_is_scoped_to_the_tenant(self, wired, repository):
        _repo, clinician = wired
        post(clinician)
        assert repository.get(keys.idempotency(TENANT, KEY)) is not None
        assert repository.get(keys.idempotency("t-other", KEY)) is None

    def test_a_reordered_body_is_the_same_request(self):
        """A client that reorders its JSON has not changed what it asked for."""
        assert fingerprint({"a": 1, "b": 2}) == fingerprint({"b": 2, "a": 1})

    def test_a_changed_value_is_a_different_request(self):
        assert fingerprint({"a": 1}) != fingerprint({"a": 2})
