"""Identity service.

    GET /me    who the caller is, and what this account may do

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

from typing import Any

from atria.core import permissions
from atria.core.errors import NotFound
from atria.core.principal import Principal
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
    }


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """GET /me"""
    principal = requests.principal_from(event)
    return responses.ok({**me(principal), **person_details(principal)})
