"""GET /me returns the caller and what the account may do.

Verifies FR-ACC-13 (a client is told what the signed-in account may do) and the
landing screen per role from the Design Specification.
"""

from __future__ import annotations

import json

import pytest

from atria.data import keys
from atria.data.people import People
from atria.http import responses
from atria.services.identity import handler as identity

pytestmark = pytest.mark.usefixtures("table")


@pytest.fixture(autouse=True)
def wired(monkeypatch, repository):
    monkeypatch.setattr(identity, "_people", People(repository))
    return repository


def event(**context: str) -> dict[str, object]:
    base = {
        "personId": "p-1",
        "tenantId": "t-cm-001",
        "roles": "PATIENT",
    }
    base.update(context)
    return {"requestContext": {"authorizer": base}, "httpMethod": "GET", "path": "/me"}


def body_of(result: dict[str, object]) -> dict[str, object]:
    return json.loads(str(result["body"]))


class TestMe:
    def test_a_patient_sees_their_own_scope_only(self):
        result = identity.handler(event(patientProfileId="pp-1"), None)
        assert result["statusCode"] == 200
        body = body_of(result)
        assert body["roles"] == ["PATIENT"]
        assert body["patientProfileId"] == "pp-1"
        assert body["permissions"]["appointment.read"] == "own"
        assert body["landing"] == ["Upcoming visits"]

    def test_a_receptionist_sees_clinic_scope(self):
        result = identity.handler(event(roles="RECEPTIONIST", staffId="s-1", clinicId="c-1"), None)
        body = body_of(result)
        assert body["permissions"]["appointment.read"] == "clinic"
        # The front desk is never granted care context, at any scope.
        assert "care_context.read" not in body["permissions"]
        assert body["landing"] == ["Today at this clinic"]

    def test_several_roles_take_the_widest_scope(self):
        result = identity.handler(
            event(roles="RECEPTIONIST,CLINIC_MANAGER", staffId="s-1", clinicId="c-1"), None
        )
        body = body_of(result)
        assert body["permissions"]["availability.read"] == "clinic"

    def test_an_unverified_phone_is_reported(self):
        result = identity.handler(event(patientProfileId="pp-1"), None)
        assert body_of(result)["phoneVerified"] is False

        verified = identity.handler(event(patientProfileId="pp-1", phoneVerified="true"), None)
        assert body_of(verified)["phoneVerified"] is True

    def test_a_request_with_no_resolved_caller_is_401(self):
        result = identity.handler({"requestContext": {}}, None)
        assert result["statusCode"] == 401
        assert body_of(result)["code"] == "unauthenticated"

    def test_the_response_carries_the_security_headers(self):
        result = identity.handler(event(), None)
        headers = result["headers"]
        assert headers["Cache-Control"] == "no-store"
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["Content-Type"] == responses.JSON_TYPE


class TestErrorHandling:
    def test_an_unexpected_failure_returns_500_and_no_detail(self, monkeypatch):
        def explode(_principal):
            raise RuntimeError("the database is on fire")

        monkeypatch.setattr(identity, "me", explode)
        result = identity.handler(event(patientProfileId="pp-1"), None)
        assert result["statusCode"] == 500
        body = body_of(result)
        assert body["code"] == "internal_error"
        assert "fire" not in json.dumps(body)


class TestNames:
    def test_the_person_record_names_the_caller(self, wired):
        wired.put(
            keys.person("p-1"),
            {
                "type": "PERSON",
                "personId": "p-1",
                "givenName": "Amina",
                "familyName": "Ngo",
                "email": "amina@example.com",
                "phoneE164": "+12025550142",
            },
        )
        body = body_of(identity.handler(event(patientProfileId="pp-1"), None))
        assert (body["givenName"], body["familyName"]) == ("Amina", "Ngo")
        assert (body["email"], body["phoneE164"]) == ("amina@example.com", "+12025550142")

    def test_an_account_with_no_person_record_has_no_names(self):
        body = body_of(identity.handler(event(patientProfileId="pp-1"), None))
        assert body["givenName"] is None
        assert body["familyName"] is None
        assert body["email"] is None
