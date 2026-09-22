"""What a staff account must be before it can exist.

A tenant administrator creates every staff account with its roles, and those
roles are fixed from then on (ADR 0015, FR-ACC-04). The fields each role needs
are in the specification, not in this file, so a change to what a clinician
must supply is a change to spec/atria_spec/roles.py and nothing else.

These rules are enforced here rather than in the form, because a form can be
skipped and this cannot.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from atria_spec import roles as spec

from atria.core.errors import Invalid

# Roles a staff account may carry. PATIENT is held through a patient profile,
# never through a staff membership (ADR 0010).
STAFF_ROLES = tuple(r for r in spec.ROLES if r != "PATIENT")

# Roles whose scope is one clinic, so an account carrying one needs a clinic.
CLINIC_SCOPED_ROLES = ("RECEPTIONIST", "CLINICIAN", "CLINIC_MANAGER")

MEMBERSHIP_STATUSES = ("INVITED", "ACTIVE", "SUSPENDED", "ENDED")

# E.164. The region pack narrows this further for the tenant's own country;
# this is the shape every number must have whatever the country.
E164 = re.compile(r"^\+[1-9]\d{7,14}$")

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")

# A clinician on the Order's roll cannot have registered before the roll, and
# cannot have registered in the future.
EARLIEST_REGISTRATION_YEAR = 1960


@dataclass(frozen=True, slots=True)
class StaffAccount:
    """A validated request to create a staff account."""

    given_name: str
    family_name: str
    phone_e164: str
    roles: tuple[str, ...]
    clinic_id: str | None = None
    email: str | None = None
    employee_number: str | None = None
    # Clinician only.
    specialty: str | None = None
    registration_year: int | None = None
    ordre_number: str | None = None
    languages: tuple[str, ...] = field(default_factory=tuple)
    qualifications: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_clinician(self) -> bool:
        return "CLINICIAN" in self.roles


def required_fields(roles: tuple[str, ...]) -> list[str]:
    """Every field the given roles require, in specification order."""
    needed: list[str] = []
    for role in roles:
        for name in spec.REQUIRED_ON_CREATE.get(role, ()):
            if name not in needed:
                needed.append(name)
    return needed


def _text(body: dict[str, object], name: str) -> str | None:
    value = body.get(name)
    if value is None:
        return None
    if not isinstance(value, str):
        raise Invalid(f"{name} must be text")
    return value.strip() or None


def _list(body: dict[str, object], name: str) -> tuple[str, ...]:
    value = body.get(name)
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise Invalid(f"{name} must be a list of text values")
    return tuple(v.strip() for v in value if v.strip())


def validate(body: dict[str, object], *, current_year: int) -> StaffAccount:
    """Turn a request body into a StaffAccount, or raise Invalid.

    The message names what is wrong and nothing else: it is shown to an
    administrator, and it must not leak whether some other account exists.
    """
    roles = _list(body, "roles")
    if not roles:
        raise Invalid("at least one role is required")
    unknown = [r for r in roles if r not in STAFF_ROLES]
    if unknown:
        raise Invalid(
            "unknown or non staff role",
            detail={"roles": unknown, "allowed": list(STAFF_ROLES)},
        )
    if len(set(roles)) != len(roles):
        raise Invalid("a role is listed twice")

    given_name = _text(body, "givenName")
    family_name = _text(body, "familyName")
    phone = _text(body, "phoneE164")
    clinic_id = _text(body, "clinicId")
    email = _text(body, "email")
    specialty = _text(body, "specialty")
    ordre_number = _text(body, "ordreNumber")
    languages = _list(body, "languages")
    registration_year = body.get("registrationYear")

    supplied: dict[str, object] = {
        "givenName": given_name,
        "familyName": family_name,
        "phoneE164": phone,
        "clinicId": clinic_id,
        "email": email,
        "specialty": specialty,
        "ordreNumber": ordre_number,
        "registrationYear": registration_year,
        "languages": languages,
    }
    missing = [name for name in required_fields(roles) if not supplied.get(name)]
    if missing:
        raise Invalid(
            "required fields are missing", detail={"missing": missing, "roles": list(roles)}
        )
    # Every required field is present, so the ones every role requires are set.
    if given_name is None or family_name is None or phone is None:  # pragma: no cover
        raise Invalid("required fields are missing")

    if not E164.match(phone):
        raise Invalid("phoneE164 must be in E.164 form, for example +237600000000")

    if email is not None and not EMAIL.match(email):
        raise Invalid("email is not a valid address")

    # A clinic scoped role without a clinic would carry a scope that matches
    # nothing, which fails closed but is a misconfiguration, not a decision.
    if any(r in CLINIC_SCOPED_ROLES for r in roles) and not clinic_id:
        raise Invalid("clinicId is required for a role scoped to a clinic")

    year: int | None = None
    if "CLINICIAN" in roles:
        if isinstance(registration_year, bool) or not isinstance(registration_year, int):
            raise Invalid("registrationYear must be a whole number")
        if not EARLIEST_REGISTRATION_YEAR <= registration_year <= current_year:
            raise Invalid(
                "registrationYear is out of range",
                detail={"earliest": EARLIEST_REGISTRATION_YEAR, "latest": current_year},
            )
        year = registration_year

    return StaffAccount(
        given_name=given_name,
        family_name=family_name,
        phone_e164=phone,
        roles=roles,
        clinic_id=clinic_id,
        email=email,
        employee_number=_text(body, "employeeNumber"),
        specialty=specialty,
        registration_year=year,
        ordre_number=ordre_number,
        languages=languages,
        qualifications=_list(body, "qualifications"),
    )


def validate_roles_change(body: dict[str, object]) -> tuple[str, ...]:
    """The roles an account is being changed to.

    Takes effect at the account's next sign-in, because roles travel in the
    token (ADR 0015). The caller is told that, so the change is not mistaken
    for something immediate.
    """
    roles = _list(body, "roles")
    if not roles:
        raise Invalid("at least one role is required")
    unknown = [r for r in roles if r not in STAFF_ROLES]
    if unknown:
        raise Invalid("unknown or non staff role", detail={"roles": unknown})
    if len(set(roles)) != len(roles):
        raise Invalid("a role is listed twice")
    return roles


def seniority_band(registration_year: int, *, current_year: int) -> str:
    """The band a clinician's listing sorts by.

    Derived from the year on the Order's roll, never from a rating: the
    directory must order clinicians without asserting quality (ADR 0011).
    """
    years = max(0, current_year - registration_year)
    if years >= 20:
        return "SENIOR"
    if years >= 10:
        return "EXPERIENCED"
    if years >= 3:
        return "ESTABLISHED"
    return "RECENT"
