"""Only a tenant administrator provisions staff, and nothing is half made.

Verifies FR-ACC-03 and FR-ACC-04 (staff accounts are created by a tenant
administrator, never by self-registration), FR-ACC-09 (staff act only within
their scope) and FR-ACC-18 (a role change applies at the next sign-in).

The pool and the table are both moto here, so the two-step write and its
rollback are exercised rather than mocked away.
"""

from __future__ import annotations

import json

import boto3
import pytest

from atria.data.people import People
from atria.data.repository import Repository
from atria.services.identity import staff as service

TENANT = "t-cm-001"
CLINIC = "c-douala-01"

BODY = {
    "givenName": "Amina",
    "familyName": "Ngo",
    "phoneE164": "+237600000001",
    "clinicId": CLINIC,
    "roles": ["RECEPTIONIST"],
}


@pytest.fixture
def pool(aws_credentials):
    from moto import mock_aws

    with mock_aws():
        client = boto3.client("cognito-idp", region_name="us-east-1")
        created = client.create_user_pool(PoolName="atria-test-users")
        yield created["UserPool"]["Id"]


@pytest.fixture
def wired(monkeypatch, repository, pool):
    """Point the service at the moto table and the moto pool."""
    monkeypatch.setattr(service, "USER_POOL_ID", pool)
    monkeypatch.setattr(service, "_people", People(repository))
    return repository


def admin_event(method: str, resource: str, body: object = None, **path: str) -> dict[str, object]:
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": path or None,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {
            "authorizer": {
                "personId": "p-admin",
                "tenantId": TENANT,
                "roles": "TENANT_ADMIN",
                "staffId": "s-admin",
            }
        },
    }


def body_of(result: dict[str, object]) -> dict[str, object]:
    return json.loads(str(result["body"]))


class TestCreate:
    def test_an_administrator_creates_an_account(self, wired):
        result = service.handler(admin_event("POST", "/admin/staff", BODY), None)
        assert result["statusCode"] == 201
        created = body_of(result)
        assert created["roles"] == ["RECEPTIONIST"]
        assert created["clinicId"] == CLINIC
        assert created["status"] == "INVITED"
        assert created["staffId"]

    def test_the_temporary_password_is_returned_once_and_not_the_account_secret(self, wired):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        # The administrator has to pass it on, so it is in the response, but it
        # is the only place it appears: nothing stores or logs it.
        assert len(str(created["temporaryPassword"])) >= 12
        assert created["signInName"] == BODY["phoneE164"]

    def test_the_account_exists_in_the_pool(self, wired, pool):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        client = boto3.client("cognito-idp", region_name="us-east-1")
        user = client.admin_get_user(UserPoolId=pool, Username=str(created["signInName"]))
        assert user["Username"]

    def test_the_new_account_can_be_resolved_at_sign_in(self, wired, pool):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        client = boto3.client("cognito-idp", region_name="us-east-1")
        user = client.admin_get_user(UserPoolId=pool, Username=str(created["signInName"]))
        subject = next(a["Value"] for a in user["UserAttributes"] if a["Name"] == "sub")
        resolved = People(Repository(table=wired._table)).resolve(subject)
        assert resolved is not None
        assert resolved.roles == ("RECEPTIONIST",)
        assert resolved.clinic_id == CLINIC

    def test_a_second_account_with_the_same_phone_number_is_a_conflict(self, wired):
        first = service.handler(admin_event("POST", "/admin/staff", BODY), None)
        assert first["statusCode"] == 201
        second = service.handler(admin_event("POST", "/admin/staff", BODY), None)
        assert second["statusCode"] == 409
        assert body_of(second)["code"] == "conflict"

    def test_a_receptionist_cannot_create_an_account(self, wired):
        event = admin_event("POST", "/admin/staff", BODY)
        event["requestContext"]["authorizer"]["roles"] = "RECEPTIONIST"
        result = service.handler(event, None)
        assert result["statusCode"] == 403
        assert body_of(result)["detail"] == {"permission": "staff.create"}

    def test_a_clinician_cannot_create_an_account(self, wired):
        event = admin_event("POST", "/admin/staff", BODY)
        event["requestContext"]["authorizer"]["roles"] = "CLINICIAN"
        assert service.handler(event, None)["statusCode"] == 403

    def test_a_patient_cannot_create_an_account(self, wired):
        # FR-ACC-03: self-registration exists for patients only, and it does
        # not run through here.
        event = admin_event("POST", "/admin/staff", BODY)
        event["requestContext"]["authorizer"]["roles"] = "PATIENT"
        assert service.handler(event, None)["statusCode"] == 403

    def test_a_bad_body_is_a_400_with_what_is_missing(self, wired):
        body = {k: v for k, v in BODY.items() if k != "clinicId"}
        result = service.handler(admin_event("POST", "/admin/staff", body), None)
        assert result["statusCode"] == 400
        assert "clinicId" in body_of(result)["detail"]["missing"]

    def test_no_body_is_a_400(self, wired):
        assert service.handler(admin_event("POST", "/admin/staff"), None)["statusCode"] == 400

    def test_a_failed_record_write_removes_the_pool_account(self, wired, pool, monkeypatch):
        """Nothing half made: the pool account goes back if the table write fails."""

        def explode(**_kwargs):
            raise RuntimeError("table unavailable")

        monkeypatch.setattr(service.people(), "create_staff_account", explode)
        result = service.handler(admin_event("POST", "/admin/staff", BODY), None)
        assert result["statusCode"] == 500

        client = boto3.client("cognito-idp", region_name="us-east-1")
        with pytest.raises(client.exceptions.UserNotFoundException):
            client.admin_get_user(UserPoolId=pool, Username=str(BODY["phoneE164"]))


class TestRolesChange:
    def test_roles_are_changed_and_the_caller_is_told_when_it_applies(self, wired):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        staff_id = str(created["staffId"])
        result = service.handler(
            admin_event(
                "PATCH",
                "/admin/staff/{id}/roles",
                {"roles": ["RECEPTIONIST", "CLINIC_MANAGER"]},
                id=staff_id,
            ),
            None,
        )
        assert result["statusCode"] == 200
        changed = body_of(result)
        assert changed["roles"] == ["RECEPTIONIST", "CLINIC_MANAGER"]
        assert "next sign-in" in str(changed["note"])

    def test_the_patient_role_cannot_be_granted_to_a_staff_account(self, wired):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        result = service.handler(
            admin_event(
                "PATCH",
                "/admin/staff/{id}/roles",
                {"roles": ["PATIENT"]},
                id=str(created["staffId"]),
            ),
            None,
        )
        assert result["statusCode"] == 400

    def test_an_account_in_another_tenant_is_not_found(self, wired):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        event = admin_event(
            "PATCH", "/admin/staff/{id}/roles", {"roles": ["CLINICIAN"]}, id=str(created["staffId"])
        )
        event["requestContext"]["authorizer"]["tenantId"] = "t-other"
        result = service.handler(event, None)
        assert result["statusCode"] == 404

    def test_a_receptionist_cannot_change_roles(self, wired):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        event = admin_event(
            "PATCH", "/admin/staff/{id}/roles", {"roles": ["CLINICIAN"]}, id=str(created["staffId"])
        )
        event["requestContext"]["authorizer"]["roles"] = "RECEPTIONIST"
        assert service.handler(event, None)["statusCode"] == 403


class TestSuspend:
    def test_suspending_sets_the_status_and_says_sessions_are_revoked(self, wired):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        result = service.handler(
            admin_event("POST", "/admin/staff/{id}/suspend", id=str(created["staffId"])), None
        )
        assert result["statusCode"] == 200
        suspended = body_of(result)
        assert suspended["status"] == "SUSPENDED"
        assert "revoked" in str(suspended["note"]).lower()

    def test_a_suspended_account_no_longer_resolves_to_its_roles(self, wired, pool):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        service.handler(
            admin_event("POST", "/admin/staff/{id}/suspend", id=str(created["staffId"])), None
        )
        client = boto3.client("cognito-idp", region_name="us-east-1")
        user = client.admin_get_user(UserPoolId=pool, Username=str(created["signInName"]))
        subject = next(a["Value"] for a in user["UserAttributes"] if a["Name"] == "sub")
        resolved = People(Repository(table=wired._table)).resolve(subject)
        assert resolved is not None
        assert resolved.roles == ()

    def test_a_clinic_manager_cannot_suspend(self, wired):
        created = body_of(service.handler(admin_event("POST", "/admin/staff", BODY), None))
        event = admin_event("POST", "/admin/staff/{id}/suspend", id=str(created["staffId"]))
        event["requestContext"]["authorizer"]["roles"] = "CLINIC_MANAGER"
        assert service.handler(event, None)["statusCode"] == 403
