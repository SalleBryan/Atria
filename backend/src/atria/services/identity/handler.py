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


def person_details(person_id: str) -> dict[str, str | None]:
    """The caller's own names, email and mobile, from their person record."""
    try:
        person = people().person_record(person_id)
    except NotFound:
        return dict.fromkeys(PERSON_FIELDS)
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
    return responses.ok({**me(principal), **person_details(principal.person_id)})
