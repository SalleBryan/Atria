"""The patient register, for staff (FR-STF-06, FR-STF-07, FR-BKG-07).

    GET  /patients?q=          find a patient by name, phone or patient number
    POST /patients             a minimal record made at the desk, no account
    GET  /patients/{id}        the record: contact, verification, visits in scope

A regional hospital keeps one register, so the desk of any unit can find any
of its patients to book them: patient.read at clinic scope reaches the search.
What the record then shows is bounded by that scope: a receptionist or unit
manager sees the visits in their unit, a clinician their own, an administrator
all of them. Care context is never on the record (FR-STF-07, FR-PRV-10), and
every search and record read is an audit entry naming the patients it showed
(http.audit).
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from atria_spec import region_packs

from atria.core import permissions
from atria.core.errors import AtriaError, Conflict, Forbidden, Invalid, NotFound
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.booking import FUTURE_YEARS, HISTORY_YEARS, Booking
from atria.data.people import People
from atria.data.register import Register, view
from atria.data.repository import Repository
from atria.http import requests, responses
from atria.http.handler import api
from atria.http.paging import page
from atria.http.views import appointment_view

_repo: Repository | None = None

NAME = re.compile(r"^[^\d@#<>]{1,60}$")


def repository() -> Repository:
    global _repo
    if _repo is None:
        _repo = Repository()
    return _repo


def use(repo: Repository | None) -> None:
    """Point the service at a table. For tests."""
    global _repo
    _repo = repo


def pack_for(tenant_id: str) -> dict[str, Any]:
    tenant = repository().get(keys.tenant(tenant_id)) or {}
    return region_packs.region_pack(str(tenant.get("regionPackCode") or "CM"))


def search(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    scope = permissions.require(principal, "patient.read")
    if not principal.is_staff:
        raise permissions_error("patient.read")
    # A deleted account waiting out its 30 days is the administrator's to
    # restore; the desk no longer finds it (services/identity/deletion.py).
    everyone_shown = scope == "tenant"

    def shown(entry: dict[str, Any]) -> bool:
        return everyone_shown or not entry.get("deletionPurgeAt")

    query = (requests.query_parameter(event, "q") or "").strip()
    if len(query) > 60:
        raise Invalid("that search is too long")
    sort = (requests.query_parameter(event, "sort") or "date_desc").strip()
    if not query:
        # No search: the register itself, a page at a time (2026-09-28).
        everyone = [e for e in Register(repository()).everyone(principal.tenant_id) if shown(e)]
        if sort == "name_asc":
            everyone.sort(
                key=lambda e: (
                    str(e.get("givenName") or "").casefold(),
                    str(e.get("familyName") or "").casefold(),
                )
            )
        elif sort == "name_desc":
            everyone.sort(
                key=lambda e: (
                    str(e.get("givenName") or "").casefold(),
                    str(e.get("familyName") or "").casefold(),
                ),
                reverse=True,
            )
        elif sort == "date_asc":
            everyone.sort(key=lambda e: str(e.get("createdAt") or ""))
        else:
            everyone.sort(key=lambda e: str(e.get("createdAt") or ""), reverse=True)
        listed, paging = page(everyone, event)
        return {"q": "", "sort": sort, **paging, "results": [view(e) for e in listed]}
    found = [
        e
        for e in Register(repository()).search(
            principal.tenant_id, query, dial_code=str(pack_for(principal.tenant_id)["dialCode"])
        )
        if shown(e)
    ]
    if sort == "name_asc":
        found.sort(
            key=lambda e: (
                str(e.get("givenName") or "").casefold(),
                str(e.get("familyName") or "").casefold(),
            )
        )
    elif sort == "name_desc":
        found.sort(
            key=lambda e: (
                str(e.get("givenName") or "").casefold(),
                str(e.get("familyName") or "").casefold(),
            ),
            reverse=True,
        )
    elif sort == "date_asc":
        found.sort(key=lambda e: str(e.get("createdAt") or ""))
    else:
        found.sort(key=lambda e: str(e.get("createdAt") or ""), reverse=True)
    return {
        "q": query,
        "sort": sort,
        "count": len(found),
        "nextCursor": None,
        "results": [view(e) for e in found],
    }


def permissions_error(permission: str) -> AtriaError:
    return Forbidden(
        "that action is not permitted for this account", detail={"permission": permission}
    )


def create(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """A minimal record: a name and a mobile number, the date of birth if known."""
    permissions.require(
        principal,
        "patient.create",
        Subject(tenant_id=principal.tenant_id, clinic_id=principal.clinic_id),
    )
    if not principal.is_staff:
        raise permissions_error("patient.create")
    body = requests.json_body(event)
    given = str(body.get("givenName") or "").strip()
    family = str(body.get("familyName") or "").strip()
    if not NAME.match(given) or not NAME.match(family):
        raise Invalid("a given name and a family name are required")
    pack = pack_for(principal.tenant_id)
    phone = str(body.get("phoneE164") or "").replace(" ", "")
    if not re.match(str(pack["msisdnPattern"]), phone) and not re.match(
        r"^\+1\d{3}55501\d{2}$", phone
    ):
        # The pack's mobile numbers, or the fictional range the development data uses.
        raise Invalid(f"a mobile number in the form {pack['dialCode']}6XXXXXXXX is required")
    born = body.get("dateOfBirth")
    if born is not None:
        try:
            day = dt.date.fromisoformat(str(born))
        except ValueError as exc:
            raise Invalid("dateOfBirth must be a date, YYYY-MM-DD") from exc
        if day > dt.datetime.now(tz=dt.UTC).date() or day.year < 1900:
            raise Invalid("that date of birth is not possible")
        born = day.isoformat()
    language = body.get("preferredLanguage")
    if language is not None and language not in pack["languages"]:
        raise Invalid(
            "preferredLanguage must be one of the region pack's",
            detail={"allowed": pack["languages"]},
        )

    register = Register(repository())
    already = register.by_phone(principal.tenant_id, phone)
    if already and not body.get("sameNumberConfirmed"):
        # Families share a phone; the desk decides, having seen who holds it.
        raise Conflict(
            "a patient already has that number",
            detail={"patients": [view(e) for e in already]},
        )
    _person, profile = People(repository()).create_desk_patient(
        tenant_id=principal.tenant_id,
        given_name=given,
        family_name=family,
        phone_e164=phone,
        date_of_birth=born,
        preferred_language=language,
        created_by_person_id=principal.person_id,
    )
    return {
        "patientProfileId": profile["patientProfileId"],
        "patientNumber": profile["patientNumber"],
        "givenName": given,
        "familyName": family,
        "phoneE164": phone,
        "dateOfBirth": born,
    }


def record(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    patient_id = requests.path_parameter(event, "id")
    repo = repository()
    profile = repo.get(keys.patient_profile(principal.tenant_id, patient_id))
    if not profile or profile.get("tenantId") != principal.tenant_id:
        raise NotFound("no such patient")
    if not principal.is_staff or patient_id == principal.patient_profile_id:
        # A patient's own record is the account screen, not the register.
        raise permissions_error("patient.read")
    scope = permissions.require(principal, "patient.read")
    if profile.get("deletionPurgeAt") and scope != "tenant":
        # Deleted and waiting out its 30 days: the administrator's alone.
        raise NotFound("no such patient")
    person = repo.get(keys.person(str(profile["personId"]))) or {}

    data = Booking(repo)
    now = data.now()
    visits = data.appointments_for_patient(
        principal.tenant_id,
        patient_id,
        since=(now.replace(year=now.year - HISTORY_YEARS)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        until=(now.replace(year=now.year + FUTURE_YEARS)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    if scope == "clinic":
        visits = [v for v in visits if v.get("clinicId") == principal.clinic_id]
    elif scope == "own":
        visits = [v for v in visits if v.get("clinicianProfileId") == principal.staff_id]
    visits.sort(key=lambda v: str(v.get("startAt")), reverse=True)

    return {
        "patientProfileId": patient_id,
        "patientNumber": profile.get("patientNumber"),
        "givenName": person.get("givenName"),
        "familyName": person.get("familyName"),
        "dateOfBirth": person.get("dateOfBirth"),
        "phoneE164": person.get("phoneE164"),
        "email": person.get("email"),
        "preferredLanguage": person.get("preferredLanguage"),
        # Whether they can sign in, and what has been proven, for the desk's checks.
        "hasAccount": bool(person.get("cognitoSub")),
        "phoneVerified": bool(person.get("phoneVerified")),
        "emailVerified": bool(person.get("emailVerified")),
        "source": profile.get("source") or "SELF",
        "createdAt": profile.get("createdAt"),
        "visitScope": scope,
        "deletionPurgeAt": profile.get("deletionPurgeAt"),
        "appointments": [appointment_view(v) for v in visits[:50]],
    }


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """GET /patients, POST /patients and GET /patients/{id}."""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    if resource.endswith("/patients/{id}") and method == "GET":
        return responses.ok(record(principal, event))
    if resource.endswith("/patients"):
        if method == "GET":
            return responses.ok(search(principal, event))
        if method == "POST":
            return responses.created(create(principal, event))
    raise AtriaError(f"no handler for {method} {resource}")
