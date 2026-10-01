"""Staff provisioning.

    GET   /admin/staff                      the accounts, a page at a time, for the console
    POST  /admin/staff                      create an account with its roles
    PATCH /admin/staff/{id}/roles           change those roles
    POST  /admin/staff/{id}/suspend         suspend the account

Only a tenant administrator reaches these, which the permission matrix decides,
not this module. What this module owns is the order of the two writes: the
account exists in the pool and in the table, or in neither.

A created account is INVITED and holds a temporary password that the
administrator passes on out of band. The password is returned once, in the
create response, and never stored or logged (FR-ACC-04).
"""

from __future__ import annotations

import datetime as dt
import os
import secrets
import string
from collections import Counter
from typing import Any

import boto3
from aws_lambda_powertools import Logger

from atria.core import permissions
from atria.core import staff as rules
from atria.core.errors import AtriaError, Conflict, Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.people import People
from atria.data.repository import Repository
from atria.http import paging, requests, responses
from atria.http.handler import api
from atria.services.identity import deletion

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
        # Deleted and waiting out its 30 days: when it becomes final.
        "purgeAt": (membership.get("deletion") or {}).get("purgeAt"),
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


# A page of the list, unless the console asks for another length (at most
# paging.PAGE_LIMIT, NFR-PERF-04).
DEFAULT_PAGE = 25

# The list's status filter. Awaiting means the temporary password has not been
# replaced yet; active means neither awaiting nor suspended.
STATUS_FILTERS = ("awaiting", "active", "suspended", "deleted")


def status_of(account: dict[str, Any]) -> str:
    """The list's word for an account: awaiting, active or suspended."""
    if account.get("status") == "SUSPENDED":
        return "suspended"
    if account.get("status") == "DELETION_PENDING":
        return "deleted"
    return "awaiting" if account.get("mustSetPassword") else "active"


# The words a role answers to in a search, as the console names it and as people say it.
ROLE_WORDS = {
    "RECEPTIONIST": "receptionist front desk",
    "CLINICIAN": "clinician doctor",
    "CLINIC_MANAGER": "unit manager clinic manager",
    "TENANT_ADMIN": "tenant administrator admin",
}


def matches(account: dict[str, Any], words: str) -> bool:
    """Whether a search finds the account: by name, sign-in name, role or employee number."""
    if not words:
        return True
    given = str(account.get("givenName") or "")
    family = str(account.get("familyName") or "")
    fields = [
        f"{given} {family}",
        f"{family} {given}",
        str(account.get("email") or ""),
        str(account.get("phoneE164") or ""),
        str(account.get("employeeNumber") or ""),
        *(ROLE_WORDS.get(role, role.lower()) for role in account.get("roles", [])),
    ]
    digits = "".join(ch for ch in words if ch.isdigit())
    return any(words in field.casefold() for field in fields) or (
        len(digits) >= 3 and digits in str(account.get("phoneE164") or "")
    )


def list_accounts(
    principal: Principal, query: dict[str, str | None] | None = None
) -> dict[str, Any]:
    """The tenant's staff accounts, a page at a time, for the administration console.

    Administrators only, the same permission as creating one (staff.create).
    Suspended accounts are listed too. The list is searched (`q`) and narrowed
    (`role`, `clinic`, `status`) here, then cut into pages of at most 50
    (NFR-PERF-04); `nextCursor` asks for the page after. `facets` counts every
    account of the tenant by role, clinic and status, so the console can offer
    the most used first and say how many each filter holds.

    Two reads however large the tenant: the memberships, then the people
    behind them in batches. Whether an account still holds its temporary
    password is its INVITED status, which its first sign-in clears (see
    atria.services.identity.handler), so the user pool is not asked about each
    account: that took five seconds for fifty, against the 800ms a read is
    allowed (NFR-PERF-01).
    """
    permissions.require(principal, "staff.create", Subject(tenant_id=principal.tenant_id))
    query = query or {}
    status = query.get("status") or None
    if status and status not in STATUS_FILTERS:
        raise Invalid(f"status must be one of {', '.join(STATUS_FILTERS)}")

    everyone = [
        {
            **account_view(membership, person),
            "signInName": str(person.get("email") or person.get("phoneE164") or "") or None,
            "mustSetPassword": membership.get("status") == "INVITED",
        }
        for membership, person in people().staff_accounts(principal.tenant_id)
    ]

    facets = {
        "roles": dict(Counter(role for a in everyone for role in a["roles"])),
        "clinics": dict(Counter(str(a["clinicId"]) for a in everyone if a.get("clinicId"))),
        "status": dict(Counter(status_of(a) for a in everyone)),
    }

    words = str(query.get("q") or "").strip().casefold()
    role = query.get("role") or None
    clinic = query.get("clinic") or None
    found = [
        a
        for a in everyone
        if matches(a, words)
        and (not role or role in a["roles"])
        and (not clinic or a.get("clinicId") == clinic)
        and (not status or status_of(a) == status)
    ]

    sort_order = query.get("sort") or "name_asc"

    def name_key(a: dict[str, Any]) -> tuple[str, str]:
        return (a.get("familyName") or "").casefold(), (a.get("givenName") or "").casefold()

    if sort_order == "name_desc":
        found.sort(key=name_key, reverse=True)
    elif sort_order == "date_desc":
        found.sort(key=lambda a: str(a.get("createdAt") or a.get("staffId") or ""), reverse=True)
    elif sort_order == "date_asc":
        found.sort(key=lambda a: str(a.get("createdAt") or a.get("staffId") or ""))
    else:
        found.sort(key=name_key)

    shown, more = paging.window(
        found, limit=query.get("limit"), cursor=query.get("cursor"), default=DEFAULT_PAGE
    )
    held = allowances(principal.tenant_id, [str(a["staffId"]) for a in shown])
    shown = [{**a, "priorityAllowance": held.get(str(a["staffId"]))} for a in shown]
    return {**more, "total": len(everyone), "accounts": shown, "facets": facets}


# Guard BOUNDED_PRIORITY (FR-STF-13): the most a month's allowance can be.
MAX_PRIORITY_QUOTA = 10


def this_month() -> str:
    return dt.datetime.now(tz=dt.UTC).strftime("%Y-%m")


def allowance_view(item: dict[str, Any]) -> dict[str, Any]:
    """The allowance as it stands this month: a new month starts at none used."""
    month = this_month()
    return {
        "quotaPerMonth": int(item.get("quotaPerMonth") or 0),
        "usedThisMonth": int(item.get("usedThisMonth") or 0)
        if item.get("usageMonth") == month
        else 0,
        "month": month,
        "grantedByPersonId": item.get("grantedByPersonId"),
        "grantedAt": item.get("grantedAt"),
    }


def allowances(tenant_id: str, staff_ids: list[str]) -> dict[str, dict[str, Any]]:
    repo = people().repository
    wanted = [keys.priority_allowance(tenant_id, s) for s in staff_ids]
    found = repo.get_many(wanted)
    out = {}
    for staff_id, key in zip(staff_ids, wanted, strict=True):
        item = found.get((key.pk, key.sk))
        if item and int(item.get("quotaPerMonth") or 0) > 0:
            out[staff_id] = allowance_view(item)
    return out


def set_priority(principal: Principal, staff_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Grant, change or withdraw a staff member's monthly priority allowance.

    The only staff priority there is (guard BOUNDED_PRIORITY): explicit,
    bounded, and shown with its usage. 0 withdraws it.
    """
    permissions.require(
        principal, "priority_allowance.grant", Subject(tenant_id=principal.tenant_id)
    )
    quota = body.get("quotaPerMonth")
    if (
        isinstance(quota, bool)
        or not isinstance(quota, int)
        or not 0 <= quota <= MAX_PRIORITY_QUOTA
    ):
        raise Invalid(f"quotaPerMonth is a whole number from 0 to {MAX_PRIORITY_QUOTA}")
    membership = people().staff(principal.tenant_id, staff_id)
    if membership.get("status") in ("SUSPENDED", "ENDED"):
        raise Conflict("a suspended account holds no allowance")
    repo = people().repository
    key = keys.priority_allowance(principal.tenant_id, staff_id)
    current = repo.get(key) or {}
    item = {
        "type": "PRIORITY_ALLOWANCE",
        "priorityAllowanceId": current.get("priorityAllowanceId") or f"pa-{staff_id}",
        "staffMembershipId": staff_id,
        "tenantId": principal.tenant_id,
        "quotaPerMonth": quota,
        "usedThisMonth": int(current.get("usedThisMonth") or 0),
        "usageMonth": current.get("usageMonth") or this_month(),
        "grantedByPersonId": principal.person_id,
        "grantedAt": dt.datetime.now(tz=dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    repo.put(key, item)
    return {"staffId": staff_id, "priorityAllowance": allowance_view(item) if quota else None}


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
    """GET and POST /admin/staff, PATCH /admin/staff/{id}/roles, POST /admin/staff/{id}/suspend"""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))

    if method == "GET" and resource.endswith("/staff"):
        query = {
            name: requests.query_parameter(event, name)
            for name in ("q", "role", "clinic", "status", "limit", "cursor", "sort")
        }
        return responses.ok(list_accounts(principal, query))
    if method == "POST" and resource.endswith("/staff"):
        return responses.created(create(principal, requests.json_body(event)))
    if method == "PATCH" and resource.endswith("/roles"):
        staff_id = requests.path_parameter(event, "id")
        return responses.ok(change_roles(principal, staff_id, requests.json_body(event)))
    if method == "PUT" and resource.endswith("/priority-allowance"):
        staff_id = requests.path_parameter(event, "id")
        return responses.ok(set_priority(principal, staff_id, requests.json_body(event)))
    if method == "POST" and resource.endswith("/suspend"):
        return responses.ok(suspend(principal, requests.path_parameter(event, "id")))
    # Deleting and restoring accounts, with 30 days' grace (deletion.py).
    now = dt.datetime.now(tz=dt.UTC)
    if method == "DELETE" and resource.endswith("/admin/staff/{id}"):
        return responses.ok(
            deletion.delete_staff(
                people(), actor=principal, staff_id=requests.path_parameter(event, "id"), now=now
            )
        )
    if method == "POST" and resource.endswith("/admin/staff/{id}/restore"):
        return responses.ok(
            deletion.restore_staff(
                people(), actor=principal, staff_id=requests.path_parameter(event, "id")
            )
        )
    if method == "DELETE" and resource.endswith("/admin/patients/{id}"):
        return responses.ok(
            deletion.delete_patient_as_admin(
                people(), principal, requests.path_parameter(event, "id"), now=now
            )
        )
    if method == "POST" and resource.endswith("/admin/patients/{id}/restore"):
        return responses.ok(
            deletion.restore_patient_as_admin(
                people(), principal, requests.path_parameter(event, "id")
            )
        )

    # Every route on this function is listed above, so this is a wiring
    # mistake in the API stack rather than anything the caller did.
    raise AtriaError(f"no handler for {method} {resource}")
