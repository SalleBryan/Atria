"""GET /clinicians and GET /clinicians/{id}/slots.

Verifies FR-DIR-01 (a patient lists the clinicians of their tenant, filtered
and searchable), FR-DIR-02 (the free start times for one clinician, date and
appointment type) and ADR 0011, which is why no response here carries a score.

The slot list and the booking path read the same lock items, so a start offered
here is refused with a 409 if somebody takes it in between. That agreement is
what these tests are really about.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from atria.core import staff as staff_rules
from atria.data import keys
from atria.data.booking import Booking
from atria.data.people import People
from atria.services.booking import appointments as booking_service
from atria.services.directory import clinicians as service

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
YAOUNDE = "c-yaounde-01"
PATIENT = "pp-1"

# A Wednesday. The clinic opens 08:00 to 12:00 local, so 07:00 to 11:00 UTC.
DAY = "2026-03-04"
NOW = dt.datetime(2026, 3, 3, 6, 0, tzinfo=dt.UTC)

TYPE_ID = "at-spec-first"


@pytest.fixture
def wired(monkeypatch, repository):
    people = People(repository)
    booking = Booking(repository, clock=lambda: NOW)
    monkeypatch.setattr(service, "_people", people)
    monkeypatch.setattr(service, "_booking", booking)
    monkeypatch.setattr(booking_service, "_booking", booking)

    repository.put(
        keys.tenant(TENANT),
        {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10, "regionPackCode": "CM"},
    )
    repository.put(
        keys.region_pack("CM"),
        {"type": "REGION_PACK", "code": "CM", "timezone": "Africa/Douala"},
    )
    for clinic_id in (DOUALA, YAOUNDE):
        repository.put(
            keys.clinic(TENANT, clinic_id),
            {
                "type": "CLINIC",
                "clinicId": clinic_id,
                "tenantId": TENANT,
                "openingHours": {"2": {"start": "08:00", "end": "12:00"}},
            },
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
    return repository


@pytest.fixture
def clinicians(wired):
    people = People(wired)
    made = {}
    for family_name, year, specialty, clinic in (
        ("Etoa", 2012, "Paediatrics", DOUALA),
        ("Abena", 1998, "Cardiology", DOUALA),
        ("Manga", 2021, "Paediatrics", YAOUNDE),
    ):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT,
            account=staff_rules.StaffAccount(
                given_name="Paul",
                family_name=family_name,
                phone_e164=f"+23760000{year}",
                roles=("CLINICIAN",),
                clinic_id=clinic,
                specialty=specialty,
                registration_year=year,
                ordre_number=f"CM-ONMC-{family_name}",
                languages=("fr", "en"),
            ),
        )
        made[family_name] = membership["staffMembershipId"]
    return made


def event(resource: str, *, path: dict | None = None, query: dict | None = None, **context):
    base = {
        "personId": "p-1",
        "tenantId": TENANT,
        "roles": "PATIENT",
        "patientProfileId": PATIENT,
    }
    base.update(context)
    return {
        "httpMethod": "GET",
        "resource": resource,
        "pathParameters": path,
        "queryStringParameters": query,
        "requestContext": {"authorizer": base},
    }


def body_of(result: dict[str, object]) -> dict:
    return json.loads(str(result["body"]))


class TestDirectory:
    def test_a_patient_lists_the_clinicians_of_their_tenant(self, clinicians):
        result = service.handler(event("/clinicians"), None)
        assert result["statusCode"] == 200
        assert body_of(result)["count"] == 3

    def test_the_listing_is_most_senior_first(self, clinicians):
        listed = body_of(service.handler(event("/clinicians"), None))["clinicians"]
        assert [c["familyName"] for c in listed] == ["Abena", "Etoa", "Manga"]

    def test_the_listing_carries_no_score(self, clinicians):
        """ADR 0011: never a rating, at any scope."""
        for entry in body_of(service.handler(event("/clinicians"), None))["clinicians"]:
            assert set(entry) == set(service.LISTED_FIELDS)

    def test_filtered_by_specialty(self, clinicians):
        found = body_of(
            service.handler(event("/clinicians", query={"specialty": "Cardiology"}), None)
        )
        assert [c["familyName"] for c in found["clinicians"]] == ["Abena"]

    def test_filtered_by_clinic(self, clinicians):
        found = body_of(service.handler(event("/clinicians", query={"clinicId": YAOUNDE}), None))
        assert [c["familyName"] for c in found["clinicians"]] == ["Manga"]

    def test_searched_by_name(self, clinicians):
        found = body_of(service.handler(event("/clinicians", query={"name": "aben"}), None))
        assert [c["familyName"] for c in found["clinicians"]] == ["Abena"]

    def test_a_suspended_clinician_is_not_offered(self, clinicians, wired):
        People(wired).set_status(tenant_id=TENANT, staff_id=clinicians["Etoa"], status="SUSPENDED")
        found = body_of(service.handler(event("/clinicians"), None))
        assert "Etoa" not in {c["familyName"] for c in found["clinicians"]}

    def test_another_tenants_patient_sees_nothing(self, clinicians):
        found = body_of(service.handler(event("/clinicians", tenantId="t-other"), None))
        assert found["count"] == 0


class TestSlots:
    def slots(self, clinicians, *, who: str = "Etoa", query: dict | None = None, **context):
        parameters = {"date": DAY, "typeId": TYPE_ID}
        parameters.update(query or {})
        return service.handler(
            event(
                "/clinicians/{id}/slots",
                path={"id": clinicians[who]},
                query=parameters,
                **context,
            ),
            None,
        )

    def test_an_open_day_offers_starts_inside_the_clinics_hours(self, clinicians):
        result = self.slots(clinicians)
        assert result["statusCode"] == 200
        body = body_of(result)
        assert body["slots"][0]["startAt"] == "2026-03-04T07:00:00Z"
        assert body["slots"][-1]["startAt"] == "2026-03-04T10:20:00Z"

    def test_the_end_offered_is_the_duration_not_the_buffer(self, clinicians):
        first = body_of(self.slots(clinicians))["slots"][0]
        assert first["endAt"] == "2026-03-04T07:30:00Z"

    def test_a_closed_day_offers_nothing(self, clinicians):
        """The clinic has hours for Wednesday only."""
        body = body_of(self.slots(clinicians, query={"date": "2026-03-02"}))
        assert body["slots"] == []

    def test_a_booking_removes_the_starts_it_holds(self, clinicians, wired):
        before = body_of(self.slots(clinicians))["slots"]
        booked = booking_service.handler(
            {
                "httpMethod": "POST",
                "resource": "/appointments",
                "body": json.dumps(
                    {
                        "appointmentTypeId": TYPE_ID,
                        "clinicianProfileId": clinicians["Etoa"],
                        "startAt": "2026-03-04T08:00:00Z",
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
        assert booked["statusCode"] == 201

        after = body_of(self.slots(clinicians))["slots"]
        starts = {s["startAt"] for s in after}
        assert len(after) < len(before)
        assert "2026-03-04T08:00:00Z" not in starts
        # 07:30 would hold 08:00 through its own buffer, so it goes too.
        assert "2026-03-04T07:30:00Z" not in starts
        assert "2026-03-04T07:10:00Z" in starts

    def test_an_unavailable_exception_removes_the_starts_it_covers(self, clinicians, wired):
        wired.put(
            keys.availability_exception(TENANT, clinicians["Etoa"], "2026-03-04T09:00"),
            {
                "type": "AVAILABILITY_EXCEPTION",
                "kind": "UNAVAILABLE",
                "exceptionDate": "2026-03-04",
                "startTime": "09:00",
                "endTime": "10:00",
            },
        )
        starts = {s["startAt"] for s in body_of(self.slots(clinicians))["slots"]}
        # 09:00 to 10:00 local is 08:00 to 09:00 UTC.
        assert "2026-03-04T08:30:00Z" not in starts
        assert "2026-03-04T09:00:00Z" in starts

    def test_the_response_says_which_grid_it_used(self, clinicians):
        body = body_of(self.slots(clinicians))
        assert body["gridUnitMinutes"] == 10
        assert body["durationUnits"] == 3
        assert body["clinicId"] == DOUALA

    def test_a_missing_type_is_refused(self, clinicians):
        result = self.slots(clinicians, query={"typeId": None})
        assert result["statusCode"] == 400

    def test_a_malformed_date_is_refused(self, clinicians):
        assert self.slots(clinicians, query={"date": "next tuesday"})["statusCode"] == 400

    def test_an_unknown_clinician_is_not_found(self, clinicians):
        result = service.handler(
            event(
                "/clinicians/{id}/slots",
                path={"id": "s-nobody"},
                query={"date": DAY, "typeId": TYPE_ID},
            ),
            None,
        )
        assert result["statusCode"] == 404

    def test_a_suspended_clinician_offers_no_slots(self, clinicians, wired):
        People(wired).set_status(tenant_id=TENANT, staff_id=clinicians["Etoa"], status="SUSPENDED")
        assert self.slots(clinicians)["statusCode"] == 409

    def test_a_request_with_no_caller_is_unauthenticated(self, clinicians):
        stripped = event("/clinicians")
        stripped["requestContext"] = {}
        assert service.handler(stripped, None)["statusCode"] == 401
