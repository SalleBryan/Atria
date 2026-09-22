"""Staff provisioning.

    POST  /admin/staff                      create an account with its roles
    PATCH /admin/staff/{id}/roles           change those roles
    POST  /admin/staff/{id}/suspend         suspend the account

Only a tenant administrator reaches these, which the permission matrix decides,
not this module. What this module owns is the order of the two writes: the
account exists in the pool and in the table, or in neither.

A created account is INVITED and holds a temporary password that the
administrator passes on out of band. The password is never returned in the
response and never logged (FR-ACC-04).
"""

from __future__ import annotations

import os
import secrets
import string
from typing import Any

import boto3
from aws_lambda_powertools import Logger

from atria.core import permissions
from atria.core import staff as rules
from atria.core.errors import AtriaError, Conflict, Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.people import People
from atria.data.repository import Repository
from atria.http import requests, responses
from atria.http.handler import api

logger = Logger(service="atria-staff")

USER_POOL_ID = os.environ.get("USER_POOL_ID", "")

# Long enough that it is not guessable, and it is replaced at first sign-in.
TEMPORARY_PASSWORD_LENGTH = 16

_people: People | None = None


def people() -> People:
    global _people
    if _people is None:
        _people = People(Repository())
    return _people


def cognito() -> Any:
    return boto3.client("cognito-idp")


def temporary_password() -> str:
    """A password that satisfies the pool's policy by construction."""
    alphabet = string.ascii_letters + string.digits
    body = "".join(secrets.choice(alphabet) for _ in range(TEMPORARY_PASSWORD_LENGTH - 3))
    return f"{secrets.choice(string.ascii_uppercase)}{body}{secrets.choice(string.digits)}!"


def sign_in_name(account: rules.StaffAccount) -> str:
    """What the account signs in with: its email where it has one, else its phone."""
    return account.email or account.phone_e164


def account_view(membership: dict[str, Any], person: dict[str, Any]) -> dict[str, Any]:
    """What the administration console is told about an account.

    No password, and nothing about the person beyond what an administrator
    needs to recognise the account they just made.
    """
    return {
        "staffId": membership["staffMembershipId"],
        "personId": membership["personId"],
        "tenantId": membership["tenantId"],
        "clinicId": membership.get("clinicId"),
        "roles": list(membership.get("roles", [])),
        "status": membership.get("status"),
        "givenName": person.get("givenName"),
        "familyName": person.get("familyName"),
        "phoneE164": person.get("phoneE164"),
        "email": person.get("email"),
        "employeeNumber": membership.get("employeeNumber"),
    }


def create(principal: Principal, body: dict[str, Any]) -> dict[str, Any]:
    """Create the pool account first, then the records that point at it.

    The pool account comes first because its subject is what the person record
    is found by at sign-in. If the table write then fails, the pool account is
    removed again, so a half provisioned account is not left behind.
    """
    permissions.require(principal, "staff.create")
    account = rules.validate(body, current_year=people().current_year)

    if account.clinic_id is None and any(
        r in rules.CLINIC_SCOPED_ROLES for r in account.roles
    ):  # pragma: no cover  validate already refuses this
        raise Invalid("clinicId is required for a role scoped to a clinic")

    username = sign_in_name(account)
    password = temporary_password()
    client = cognito()
    try:
        created = client.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=username,
            TemporaryPassword=password,
            MessageAction="SUPPRESS",
            UserAttributes=[
                {"Name": "given_name", "Value": account.given_name},
                {"Name": "family_name", "Value": account.family_name},
                {"Name": "phone_number", "Value": account.phone_e164},
                *([{"Name": "email", "Value": account.email}] if account.email else []),
                *([{"Name": "email_verified", "Value": "true"}] if account.email else []),
            ],
        )
    except client.exceptions.UsernameExistsException as exc:
        # The phone number or email is already someone's sign-in name. Named
        # generically: which account it collides with is not this caller's to
        # learn.
        raise Conflict("that phone number or email is already in use") from exc
    subject = next((a["Value"] for a in created["User"]["Attributes"] if a["Name"] == "sub"), None)

    try:
        person, membership = people().create_staff_account(
            tenant_id=principal.tenant_id, account=account, cognito_sub=subject
        )
    except Exception:
        # Leave nothing half made. The administrator can retry the whole call.
        logger.exception("rolling back the pool account", extra={"username": username})
        client.admin_delete_user(UserPoolId=USER_POOL_ID, Username=username)
        raise

    logger.info(
        "staff account created",
        extra={
            "staffId": membership["staffMembershipId"],
            "roles": list(account.roles),
            "clinicId": account.clinic_id,
        },
    )
    return {
        **account_view(membership, person),
        "signInName": username,
        "temporaryPassword": password,
        "note": "The account signs in with the temporary password and must change it.",
    }


def change_roles(principal: Principal, staff_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Change the roles on an account. Effective at its next sign-in."""
    membership = people().staff(principal.tenant_id, staff_id)
    permissions.require(
        principal,
        "staff.update_roles",
        Subject(tenant_id=membership["tenantId"], clinic_id=membership.get("clinicId")),
    )
    roles = rules.validate_roles_change(body)
    updated = people().set_roles(tenant_id=principal.tenant_id, staff_id=staff_id, roles=roles)
    person = people().person_record(updated["personId"])
    logger.info("roles changed", extra={"staffId": staff_id, "roles": list(roles)})
    return {
        **account_view(updated, person),
        "note": "The new roles apply at the account's next sign-in.",
    }


def suspend(principal: Principal, staff_id: str) -> dict[str, Any]:
    """Suspend an account and end its sessions."""
    membership = people().staff(principal.tenant_id, staff_id)
    permissions.require(
        principal,
        "staff.suspend",
        Subject(tenant_id=membership["tenantId"], clinic_id=membership.get("clinicId")),
    )
    updated = people().set_status(
        tenant_id=principal.tenant_id, staff_id=staff_id, status="SUSPENDED"
    )
    person = people().person_record(updated["personId"])

    # Revoking the refresh tokens is what actually ends the sessions; the
    # record alone would leave a signed-in console working until its token
    # expired.
    username = person.get("email") or person.get("phoneE164")
    if username:
        try:
            cognito().admin_user_global_sign_out(UserPoolId=USER_POOL_ID, Username=str(username))
        except Exception:
            logger.exception("could not revoke sessions", extra={"staffId": staff_id})
    return {**account_view(updated, person), "note": "Sessions revoked."}


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """POST /admin/staff, PATCH /admin/staff/{id}/roles, POST /admin/staff/{id}/suspend"""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))

    if method == "POST" and resource.endswith("/staff"):
        return responses.created(create(principal, requests.json_body(event)))
    if method == "PATCH" and resource.endswith("/roles"):
        staff_id = requests.path_parameter(event, "id")
        return responses.ok(change_roles(principal, staff_id, requests.json_body(event)))
    if method == "POST" and resource.endswith("/suspend"):
        return responses.ok(suspend(principal, requests.path_parameter(event, "id")))

    # Every route on this function is listed above, so this is a wiring
    # mistake in the API stack rather than anything the caller did.
    raise AtriaError(f"no handler for {method} {resource}")
