"""Identity service.

    GET /me          who the caller is, and what this account may do
    PATCH /me        change one's own name, date of birth or language
    POST /me/email   take the email Cognito has just verified (FR-ACC-01)

The first endpoint of the API. It returns the resolved caller together with the
permissions their roles carry, which is what a client uses to decide what to
show. The client hides what a role cannot do; the authoriser and the services
are what refuse it (guard rule D-10).

The person's names and contact details come from their person record, so a
screen can greet them and show them what Atria holds. The token carries who
they are, not what they are called; an account with no person record yet,
such as one resolved from its attributes alone, has none of these.

A staff account made by an administrator starts INVITED, holding a temporary
password. It cannot get a token until it has set its own, so its first call
here, which the console makes as it opens, marks it ACTIVE. That is how the
administration console knows who has not signed in yet without asking the
user pool about every account.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from typing import Any

import boto3
from atria_spec import region_packs

from atria.core import permissions
from atria.core.errors import AtriaError, Conflict, Invalid, NotFound
from atria.core.principal import Principal
from atria.data import keys, register
from atria.data.people import People
from atria.data.repository import Repository
from atria.http import requests, responses
from atria.http.handler import api

_people: People | None = None


def people() -> People:
    global _people
    if _people is None:
        _people = People(Repository())
    return _people


PERSON_FIELDS = ("givenName", "familyName", "email", "phoneE164")


def person_details(principal: Principal) -> dict[str, str | None]:
    """The caller's own names, email and mobile, from their person record."""
    try:
        person = people().person_record(principal.person_id)
    except NotFound:
        return dict.fromkeys(PERSON_FIELDS)
    if principal.staff_id and principal.tenant_id:
        invited = any(
            m.get("staffMembershipId") == principal.staff_id and m.get("status") == "INVITED"
            for m in person.get("memberships", [])
        )
        if invited:
            people().activate(tenant_id=principal.tenant_id, staff_id=principal.staff_id)
    return {name: str(person.get(name) or "") or None for name in PERSON_FIELDS}


def me(principal: Principal) -> dict[str, Any]:
    """The caller, their account's roles, and the permissions those roles grant."""
    return {
        "personId": principal.person_id,
        "tenantId": principal.tenant_id,
        "roles": list(principal.roles),
        "patientProfileId": principal.patient_profile_id,
        "staffId": principal.staff_id,
        "clinicId": principal.clinic_id,
        "phoneVerified": principal.phone_verified,
        "languages": list(principal.languages),
        "permissions": permissions.granted_to(principal),
        "landing": [permissions.landing_for(role) for role in principal.roles],
        # FR-ACC-11: the console asks an administrator to set up an
        # authenticator before anything else, and their role acts only after.
        "secondFactorRequired": principal.needs_second_factor,
    }


NAME = re.compile(r"^[^\d@#<>]{1,60}$")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
_cognito: Any = None


def cognito() -> Any:
    global _cognito
    if _cognito is None:
        _cognito = boto3.client("cognito-idp")
    return _cognito


def languages_for(tenant_id: str) -> list[str]:
    tenant = people().repository.get(keys.tenant(tenant_id)) or {}
    return list(region_packs.region_pack(str(tenant.get("regionPackCode") or "CM"))["languages"])


def edit(principal: Principal, body: dict[str, Any]) -> dict[str, Any]:
    """Change what a person may change about themselves.

    A name, a date of birth and a language. The email changes through
    Cognito's own verification (POST /me/email), and the mobile through a
    one-time code, so neither is taken from a body. A patient's register
    entries follow the name, so the desk still finds them.
    """
    repo = people().repository
    person = people().person_record(principal.person_id)
    changes: dict[str, Any] = {}
    for field in ("givenName", "familyName"):
        if field in body:
            value = str(body[field] or "").strip()
            if not NAME.match(value):
                raise Invalid(f"{field} must be a name, without digits")
            changes[field] = value
    if "dateOfBirth" in body:
        raw = body["dateOfBirth"]
        if raw in (None, ""):
            changes["dateOfBirth"] = None
        else:
            try:
                born = dt.date.fromisoformat(str(raw))
            except ValueError as exc:
                raise Invalid("dateOfBirth must be a date, YYYY-MM-DD") from exc
            if born > dt.datetime.now(tz=dt.UTC).date() or born.year < 1900:
                raise Invalid("that date of birth is not possible")
            changes["dateOfBirth"] = born.isoformat()
    if "preferredLanguage" in body:
        language = str(body["preferredLanguage"] or "")
        allowed = languages_for(principal.tenant_id)
        if language not in allowed:
            raise Invalid(
                "preferredLanguage must be one of the region pack's", detail={"allowed": allowed}
            )
        changes["preferredLanguage"] = language
    if not changes:
        raise Invalid("nothing to change: givenName, familyName, dateOfBirth or preferredLanguage")

    updated = {**person, **changes}
    repo.put(keys.person(principal.person_id), {k: v for k, v in updated.items() if v is not None})
    if principal.patient_profile_id:
        profile = (
            repo.get(keys.patient_profile(principal.tenant_id, principal.patient_profile_id)) or {}
        )
        register.Register(repo).replace(
            principal.tenant_id,
            principal.patient_profile_id,
            register.entries(
                tenant_id=principal.tenant_id,
                patient_profile_id=principal.patient_profile_id,
                person_id=principal.person_id,
                given_name=str(updated.get("givenName") or ""),
                family_name=str(updated.get("familyName") or ""),
                phone_e164=updated.get("phoneE164"),
                patient_number=profile.get("patientNumber"),
                date_of_birth=updated.get("dateOfBirth"),
            ),
        )
    return person_details(principal) | {
        "dateOfBirth": updated.get("dateOfBirth"),
        "preferredLanguage": updated.get("preferredLanguage"),
    }


def take_verified_email(principal: Principal) -> dict[str, Any]:
    """Copy the account's email into the person record once Cognito has verified it.

    The client asks Cognito to change the address and confirms the code sent
    to it; this reads the result from Cognito itself rather than trusting the
    body, so an unverified address never reaches a notice.
    """
    person = people().person_record(principal.person_id)
    sub_id = person.get("cognitoSub")
    if not sub_id:
        raise Conflict("this record has no account to take an email from")
    try:
        user = cognito().admin_get_user(UserPoolId=USER_POOL_ID, Username=str(sub_id))
    except Exception as exc:
        raise AtriaError("the account could not be read; try again") from exc
    found = {a["Name"]: a["Value"] for a in user.get("UserAttributes", [])}
    if found.get("email_verified") != "true" or not found.get("email"):
        raise Conflict("that email is not verified yet: enter the code sent to it first")
    people().repository.put(keys.person(principal.person_id), {**person, "email": found["email"]})
    return person_details(principal)


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """GET /me, PATCH /me, POST /me/email"""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    if method == "PATCH" and resource == "/me":
        edit(principal, requests.json_body(event))
    elif method == "POST" and resource == "/me/email":
        take_verified_email(principal)
    person = person_details(principal)
    extra: dict[str, Any] = {}
    try:
        record = people().person_record(principal.person_id)
        extra = {
            "dateOfBirth": record.get("dateOfBirth"),
            "preferredLanguage": record.get("preferredLanguage"),
        }
    except NotFound:
        pass
    return responses.ok({**me(principal), **person, **extra})
